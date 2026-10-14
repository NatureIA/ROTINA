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
                    new { Login = app.Configuration["SeedUsers:User1Login"] ?? "acesso1", Password = app.Configuration["SeedUsers:User1Password"] ?? "" },
                    new { Login = app.Configuration["SeedUsers:User2Login"] ?? "acesso2", Password = app.Configuration["SeedUsers:User2Password"] ?? "" }
                };

                foreach (var seed in seeds)
                {
                    if (string.IsNullOrWhiteSpace(seed.Password)) continue;

                    var normalized = seed.Login.Trim().ToLowerInvariant();
                    var existing = await db.Users.FirstOrDefaultAsync(x => x.Login.ToLower() == normalized);

                    if (existing is null)
                    {
                        db.Users.Add(new User
                        {
                            Id = Guid.NewGuid(),
                            Login = seed.Login.Trim(),
                            PasswordHash = PasswordTools.Hash(seed.Password)
                        });
                    }
                    else if (!PasswordTools.Verify(seed.Password, existing.PasswordHash))
                    {
                        existing.PasswordHash = PasswordTools.Hash(seed.Password);
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

static async Task EnsureRoutine2SchemaAsync(AppDbContext db, Action<string> setStep)
{
    async Task Run(string step, string sql)
    {
        setStep(step);
        await db.Database.ExecuteSqlRawAsync(sql);
    }

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

    setStep("schema-ready");
}
