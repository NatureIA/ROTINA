using System.Net.Mail;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Routine.Services;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Routine.Data;
using Routine.Models;
using Routine.Security;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString))
    throw new InvalidOperationException("Configure ConnectionStrings__DefaultConnection no MonsterASP.");

var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Configure Jwt__Key com pelo menos 32 caracteres no MonsterASP.");

builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlServer(connectionString));
builder.Services.AddControllers();
builder.Services.AddScoped<IPasswordResetEmailSender, HostingerPasswordResetEmailSender>();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("password-recovery", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(5),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"],
        ValidAudience = builder.Configuration["Jwt:Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        ClockSkew = TimeSpan.FromMinutes(1)
    };
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = async context =>
        {
            var subject = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            var rawVersion = context.Principal?.FindFirstValue("routine:session_version");
            if (!Guid.TryParse(subject, out var userId))
            {
                context.Fail("Sessão inválida.");
                return;
            }

            // Tokens anteriores à versão 3.3 não têm este claim: equivalem à versão zero.
            var version = 0;
            if (rawVersion is not null &&
                !int.TryParse(rawVersion, out version))
            {
                context.Fail("Sessão inválida.");
                return;
            }

            var database = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var currentVersion = await database.Users.AsNoTracking()
                .Where(x => x.Id == userId)
                .Select(x => (int?)x.SessionVersion)
                .SingleOrDefaultAsync(context.HttpContext.RequestAborted);

            if (currentVersion is null || version != currentVersion.Value)
            {
                context.Fail("Sessão revogada.");
                return;
            }

            var managed = await database.Users.AsNoTracking().Where(x => x.Id == userId)
                .Select(x => x.KiwifyManaged).SingleAsync(context.HttpContext.RequestAborted);
            if (managed)
            {
                var now = DateTime.UtcNow;
                var authorized = await database.KiwifyEntitlements.AsNoTracking().AnyAsync(x =>
                    x.UserId == userId && x.PaidThroughUtc > now &&
                    (x.Status == "active" || x.Status == "canceled" || x.Status == "late"),
                    context.HttpContext.RequestAborted);
                if (!authorized)
                    context.Fail("Acesso comercial inativo.");
            }
        }
    };
});
builder.Services.AddAuthorization();

var app = builder.Build();

var databaseReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
var databaseStep = "starting";
string? databaseErrorType = null;
int? databaseErrorNumber = null;

app.UseDefaultFiles(new DefaultFilesOptions { DefaultFileNames = new List<string> { "login.html" } });

var staticContentTypes = new FileExtensionContentTypeProvider();
staticContentTypes.Mappings[".webmanifest"] = "application/manifest+json";

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = staticContentTypes,
    OnPrepareResponse = context =>
    {
        var path = context.Context.Request.Path.Value ?? "";
        if (path.EndsWith("manifest.webmanifest", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith("service-worker.js", StringComparison.OrdinalIgnoreCase))
        {
            context.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        }
    }
});

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        bool ready;
        try
        {
            ready = await databaseReady.Task.WaitAsync(TimeSpan.FromSeconds(30));
        }
        catch (TimeoutException)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { message = "ROUTINE está finalizando a inicialização. Tente novamente em instantes." });
            return;
        }

        if (!ready)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { message = "Banco de dados temporariamente indisponível." });
            return;
        }
    }

    await next();
});

app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () =>
{
    var completed = databaseReady.Task.IsCompletedSuccessfully;
    var ready = completed && databaseReady.Task.Result;
    var failed = completed && !databaseReady.Task.Result;

    return Results.Ok(new
    {
        status = ready ? "ok" : failed ? "error" : "initializing",
        app = "ROUTINE",
        version = "2.0",
        database = ready ? "ready" : failed ? "error" : "waiting",
        databaseStep,
        databaseErrorType,
        databaseErrorNumber
    });
});
app.MapControllers();
app.MapFallbackToFile("login.html");

app.Lifetime.ApplicationStarted.Register(() =>
{
    _ = Task.Run(async () =>
    {
        const int maxAttempts = 4;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                using var scope = app.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                databaseStep = "ensure-created";
                databaseErrorType = null;
                databaseErrorNumber = null;
                await db.Database.EnsureCreatedAsync();
                await EnsureRoutine2SchemaAsync(db, step => databaseStep = step);

                var seeds = new[]
                {
                    new
                    {
                        LegacyLogin = app.Configuration["SeedUsers:User1Login"] ?? "acesso1",
                        Email = app.Configuration["SeedUsers:User1Email"] ?? "",
                        Password = app.Configuration["SeedUsers:User1Password"] ?? ""
                    },
                    new
                    {
                        LegacyLogin = app.Configuration["SeedUsers:User2Login"] ?? "acesso2",
                        Email = app.Configuration["SeedUsers:User2Email"] ?? "",
                        Password = app.Configuration["SeedUsers:User2Password"] ?? ""
                    }
                };

                foreach (var seed in seeds)
                {
                    if (string.IsNullOrWhiteSpace(seed.Password)) continue;

                    var legacyLogin = seed.LegacyLogin.Trim();
                    var hasValidEmail = TryNormalizeEmail(seed.Email, out var email, out var normalizedEmail);

                    User? existing = null;

                    if (hasValidEmail)
                    {
                        existing = await db.Users.FirstOrDefaultAsync(
                            x => x.NormalizedEmail == normalizedEmail);
                    }

                    existing ??= await db.Users.FirstOrDefaultAsync(
                        x => x.Login.ToLower() == legacyLogin.ToLower());

                    if (existing is null)
                    {
                        // A partir desta versão, contas novas só são criadas com e-mail válido.
                        if (!hasValidEmail) continue;

                        existing = new User
                        {
                            Id = Guid.NewGuid(),
                            Login = email,
                            Email = email,
                            NormalizedEmail = normalizedEmail,
                            PasswordHash = PasswordTools.Hash(seed.Password)
                        };
                        db.Users.Add(existing);
                    }
                    else
                    {
                        if (hasValidEmail)
                        {
                            var emailInUse = await db.Users.AnyAsync(x =>
                                x.Id != existing.Id &&
                                x.NormalizedEmail == normalizedEmail);

                            if (emailInUse)
                                throw new InvalidOperationException($"O e-mail configurado para {legacyLogin} já está em uso.");

                            existing.Email = email;
                            existing.NormalizedEmail = normalizedEmail;
                        }

                        // Não sobrescrever senhas alteradas pelo usuário na recuperação.
                    }
                }

                databaseStep = "seed-users";
                await db.SaveChangesAsync();
                databaseStep = "ready";
                databaseReady.TrySetResult(true);
                app.Logger.LogInformation("Banco ROUTINE 2.0 pronto após tentativa {Attempt}.", attempt);
                return;
            }
            catch (Exception ex)
            {
                var baseException = ex.GetBaseException();
                databaseErrorType = baseException.GetType().Name;
                databaseErrorNumber = baseException is SqlException sqlException ? sqlException.Number : null;

                if (attempt >= maxAttempts)
                {
                    app.Logger.LogError(ex, "Falha ao inicializar o banco/usuários/ROUTINE 2.0 após {Attempts} tentativas.", maxAttempts);
                    databaseReady.TrySetResult(false);
                    return;
                }

                var delay = TimeSpan.FromSeconds(attempt * 2);
                app.Logger.LogWarning(
                    ex,
                    "Banco ROUTINE 2.0 ainda indisponível. Tentativa {Attempt}/{MaxAttempts}; nova tentativa em {DelaySeconds}s.",
                    attempt,
                    maxAttempts,
                    delay.TotalSeconds);
                await Task.Delay(delay);
            }
        }
    });
});

await app.RunAsync();

static bool TryNormalizeEmail(string? value, out string email, out string normalizedEmail)
{
    email = string.Empty;
    normalizedEmail = string.Empty;

    var candidate = (value ?? string.Empty).Trim();
    if (!MailAddress.TryCreate(candidate, out var address)) return false;
    if (!string.Equals(address.Address, candidate, StringComparison.OrdinalIgnoreCase)) return false;

    email = address.Address.Trim();
    normalizedEmail = email.ToLowerInvariant();
    return true;
}

static async Task EnsureRoutine2SchemaAsync(AppDbContext db, Action<string> setStep)
{
    async Task Run(string step, string sql)
    {
        setStep(step);
        await db.Database.ExecuteSqlRawAsync(sql);
    }

    await Run("users-email", """
IF COL_LENGTH(N'Users', N'Email') IS NULL
    ALTER TABLE [Users] ADD [Email] nvarchar(254) NULL;
""");

    await Run("users-normalized-email", """
IF COL_LENGTH(N'Users', N'NormalizedEmail') IS NULL
    ALTER TABLE [Users] ADD [NormalizedEmail] nvarchar(254) NULL;
""");

    await Run("users-display-name", """
IF COL_LENGTH(N'Users', N'DisplayName') IS NULL
    ALTER TABLE [Users] ADD [DisplayName] nvarchar(80) NULL;
""");

    await Run("users-session-version", """
IF COL_LENGTH(N'Users', N'SessionVersion') IS NULL
    ALTER TABLE [Users] ADD [SessionVersion] int NOT NULL CONSTRAINT [DF_Users_SessionVersion] DEFAULT (0);
""");

    await Run("users-normalize-email-data", """
UPDATE [Users]
SET [NormalizedEmail] = LOWER(LTRIM(RTRIM([Email])))
WHERE [Email] IS NOT NULL
  AND LTRIM(RTRIM([Email])) <> N''
  AND ([NormalizedEmail] IS NULL OR [NormalizedEmail] <> LOWER(LTRIM(RTRIM([Email]))));
""");

    await Run("users-email-index", """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_Users_NormalizedEmail'
      AND object_id = OBJECT_ID(N'[Users]')
)
    CREATE UNIQUE INDEX [IX_Users_NormalizedEmail]
        ON [Users] ([NormalizedEmail])
        WHERE [NormalizedEmail] IS NOT NULL;
""");

    await Run("activities-client-request-id", """
IF COL_LENGTH(N'Activities', N'ClientRequestId') IS NULL
    ALTER TABLE [Activities] ADD [ClientRequestId] nvarchar(64) NULL;
""");

    await Run("activities-archived-at", """
IF COL_LENGTH(N'Activities', N'ArchivedAt') IS NULL
    ALTER TABLE [Activities] ADD [ArchivedAt] datetime2 NULL;
""");

    await Run("activities-archived-was-active", """
IF COL_LENGTH(N'Activities', N'ArchivedWasActive') IS NULL
    ALTER TABLE [Activities] ADD [ArchivedWasActive] bit NULL;
""");

    await Run("activities-idempotency-index", """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_Activities_UserId_ClientRequestId'
      AND object_id = OBJECT_ID(N'[Activities]')
)
    CREATE UNIQUE INDEX [IX_Activities_UserId_ClientRequestId]
        ON [Activities] ([UserId], [ClientRequestId])
        WHERE [ClientRequestId] IS NOT NULL;
""");

    await Run("routine-tasks-table", """
IF OBJECT_ID(N'[RoutineTasks]', N'U') IS NULL
BEGIN
    CREATE TABLE [RoutineTasks] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [ActivityId] uniqueidentifier NULL,
        [Title] nvarchar(160) NOT NULL,
        [Project] nvarchar(100) NULL,
        [DueDate] nvarchar(10) NULL,
        [DueTime] nvarchar(5) NULL,
        [Status] nvarchar(20) NOT NULL,
        [Priority] nvarchar(20) NOT NULL,
        [Notes] nvarchar(1000) NULL,
        [ClientRequestId] nvarchar(64) NULL,
        [CompletedAt] datetime2 NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_RoutineTasks] PRIMARY KEY ([Id])
    );
END;
""");

    await Run("routine-tasks-completed-at", """
IF COL_LENGTH(N'RoutineTasks', N'CompletedAt') IS NULL
    ALTER TABLE [RoutineTasks] ADD [CompletedAt] datetime2 NULL;
""");

    await Run("routine-tasks-date-index", """
IF OBJECT_ID(N'[RoutineTasks]', N'U') IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_RoutineTasks_UserId_DueDate'
      AND object_id = OBJECT_ID(N'[RoutineTasks]')
)
    CREATE INDEX [IX_RoutineTasks_UserId_DueDate]
        ON [RoutineTasks] ([UserId], [DueDate]);
""");

    await Run("routine-tasks-activity-index", """
IF OBJECT_ID(N'[RoutineTasks]', N'U') IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_RoutineTasks_ActivityId'
      AND object_id = OBJECT_ID(N'[RoutineTasks]')
)
    CREATE INDEX [IX_RoutineTasks_ActivityId]
        ON [RoutineTasks] ([ActivityId]);
""");

    await Run("routine-tasks-idempotency-index", """
IF OBJECT_ID(N'[RoutineTasks]', N'U') IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_RoutineTasks_UserId_ClientRequestId'
      AND object_id = OBJECT_ID(N'[RoutineTasks]')
)
    CREATE UNIQUE INDEX [IX_RoutineTasks_UserId_ClientRequestId]
        ON [RoutineTasks] ([UserId], [ClientRequestId])
        WHERE [ClientRequestId] IS NOT NULL;
""");

    await Run("checklist-table", """
IF OBJECT_ID(N'[ChecklistItems]', N'U') IS NULL
BEGIN
    CREATE TABLE [ChecklistItems] (
        [Id] uniqueidentifier NOT NULL,
        [TaskId] uniqueidentifier NOT NULL,
        [Title] nvarchar(200) NOT NULL,
        [Done] bit NOT NULL,
        [SortOrder] int NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_ChecklistItems] PRIMARY KEY ([Id])
    );
END;
""");

    await Run("checklist-index", """
IF OBJECT_ID(N'[ChecklistItems]', N'U') IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_ChecklistItems_TaskId_SortOrder'
      AND object_id = OBJECT_ID(N'[ChecklistItems]')
)
    CREATE INDEX [IX_ChecklistItems_TaskId_SortOrder]
        ON [ChecklistItems] ([TaskId], [SortOrder]);
""");

    await Run("habit-goals-table", """
IF OBJECT_ID(N'[HabitGoals]', N'U') IS NULL
BEGIN
    CREATE TABLE [HabitGoals] (
        [ActivityId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Mode] nvarchar(20) NOT NULL,
        [Target] decimal(12,2) NOT NULL,
        [Unit] nvarchar(20) NOT NULL,
        [CycleDays] int NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_HabitGoals] PRIMARY KEY ([ActivityId])
    );
END;
""");

    await Run("habit-goals-user-index", """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_HabitGoals_UserId' AND object_id = OBJECT_ID(N'[HabitGoals]')
)
    CREATE INDEX [IX_HabitGoals_UserId] ON [HabitGoals] ([UserId]);
""");

    await Run("habit-entries-table", """
IF OBJECT_ID(N'[HabitEntries]', N'U') IS NULL
BEGIN
    CREATE TABLE [HabitEntries] (
        [Id] uniqueidentifier NOT NULL,
        [ActivityId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Date] nvarchar(10) NOT NULL,
        [Value] decimal(12,2) NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_HabitEntries] PRIMARY KEY ([Id])
    );
END;
""");

    await Run("habit-entries-unique-index", """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_HabitEntries_UserId_ActivityId_Date'
      AND object_id = OBJECT_ID(N'[HabitEntries]')
)
    CREATE UNIQUE INDEX [IX_HabitEntries_UserId_ActivityId_Date]
        ON [HabitEntries] ([UserId], [ActivityId], [Date]);
""");

    await Run("users-kiwify-managed", """
IF COL_LENGTH(N'Users', N'KiwifyManaged') IS NULL
    ALTER TABLE [Users] ADD [KiwifyManaged] bit NOT NULL
      CONSTRAINT [DF_Users_KiwifyManaged] DEFAULT (0);
""");

    await Run("password-reset-tokens-table", """
IF OBJECT_ID(N'[PasswordResetTokens]', N'U') IS NULL
BEGIN
    CREATE TABLE [PasswordResetTokens] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [TokenHash] nvarchar(64) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [ExpiresAt] datetime2 NOT NULL,
        [UsedAt] datetime2 NULL,
        CONSTRAINT [PK_PasswordResetTokens] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_PasswordResetTokens_Users_UserId] FOREIGN KEY ([UserId])
            REFERENCES [Users] ([Id]) ON DELETE CASCADE
    );
END;
""");

    await Run("password-reset-token-hash-index", """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_PasswordResetTokens_TokenHash'
      AND object_id = OBJECT_ID(N'[PasswordResetTokens]')
)
    CREATE UNIQUE INDEX [IX_PasswordResetTokens_TokenHash]
        ON [PasswordResetTokens] ([TokenHash]);
""");

    await Run("password-reset-user-created-index", """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_PasswordResetTokens_UserId_CreatedAt'
      AND object_id = OBJECT_ID(N'[PasswordResetTokens]')
)
    CREATE INDEX [IX_PasswordResetTokens_UserId_CreatedAt]
        ON [PasswordResetTokens] ([UserId], [CreatedAt]);
""");

    await Run("kiwify-entitlements-table", """
IF OBJECT_ID(N'[KiwifyEntitlements]', N'U') IS NULL
BEGIN
    CREATE TABLE [KiwifyEntitlements] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [ProductId] nvarchar(120) NOT NULL,
        [OrderId] nvarchar(120) NOT NULL,
        [SubscriptionId] nvarchar(120) NULL,
        [Status] nvarchar(24) NOT NULL,
        [PaidThroughUtc] datetime2 NOT NULL,
        [UpdatedAtUtc] datetime2 NOT NULL,
        CONSTRAINT [PK_KiwifyEntitlements] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_KiwifyEntitlements_Users_UserId] FOREIGN KEY ([UserId])
          REFERENCES [Users] ([Id]) ON DELETE CASCADE
    );
END;
""");

    await Run("kiwify-entitlement-subscription-index", """
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_KiwifyEntitlements_ProductId_SubscriptionId'
  AND object_id = OBJECT_ID(N'[KiwifyEntitlements]'))
    CREATE UNIQUE INDEX [IX_KiwifyEntitlements_ProductId_SubscriptionId]
      ON [KiwifyEntitlements] ([ProductId], [SubscriptionId])
      WHERE [SubscriptionId] IS NOT NULL;
""");

    await Run("kiwify-entitlement-order-index", """
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_KiwifyEntitlements_ProductId_OrderId'
  AND object_id = OBJECT_ID(N'[KiwifyEntitlements]'))
    CREATE UNIQUE INDEX [IX_KiwifyEntitlements_ProductId_OrderId]
      ON [KiwifyEntitlements] ([ProductId], [OrderId]);
""");

    await Run("kiwify-entitlement-user-index", """
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_KiwifyEntitlements_UserId_PaidThroughUtc'
  AND object_id = OBJECT_ID(N'[KiwifyEntitlements]'))
    CREATE INDEX [IX_KiwifyEntitlements_UserId_PaidThroughUtc]
      ON [KiwifyEntitlements] ([UserId], [PaidThroughUtc]);
""");

    await Run("kiwify-webhook-receipts-table", """
IF OBJECT_ID(N'[KiwifyWebhookReceipts]', N'U') IS NULL
BEGIN
    CREATE TABLE [KiwifyWebhookReceipts] (
        [Id] uniqueidentifier NOT NULL,
        [EventKey] nvarchar(64) NOT NULL,
        [EventType] nvarchar(64) NOT NULL,
        [OrderId] nvarchar(120) NOT NULL,
        [SubscriptionId] nvarchar(120) NULL,
        [ProductId] nvarchar(120) NOT NULL,
        [UserId] uniqueidentifier NULL,
        [ReceivedAtUtc] datetime2 NOT NULL,
        CONSTRAINT [PK_KiwifyWebhookReceipts] PRIMARY KEY ([Id])
    );
END;
""");

    await Run("kiwify-webhook-receipt-key-index", """
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_KiwifyWebhookReceipts_EventKey'
  AND object_id = OBJECT_ID(N'[KiwifyWebhookReceipts]'))
    CREATE UNIQUE INDEX [IX_KiwifyWebhookReceipts_EventKey]
      ON [KiwifyWebhookReceipts] ([EventKey]);
""");

    setStep("schema-ready");
}
