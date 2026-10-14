using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.StaticFiles;
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
    var ready = databaseReady.Task.IsCompletedSuccessfully && databaseReady.Task.Result;
    return Results.Ok(new
    {
        status = ready ? "ok" : "initializing",
        app = "ROUTINE",
        version = "2.0",
        database = ready ? "ready" : "waiting"
    });
});
app.MapControllers();
app.MapFallbackToFile("login.html");

app.Lifetime.ApplicationStarted.Register(() =>
{
    _ = Task.Run(async () =>
    {
        try
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.EnsureCreatedAsync();
            await EnsureRoutine2SchemaAsync(db);

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

            await db.SaveChangesAsync();
            databaseReady.TrySetResult(true);
        }
        catch (Exception ex)
        {
            app.Logger.LogError(ex, "Falha ao inicializar o banco/usuários/ROUTINE 2.0.");
            databaseReady.TrySetResult(false);
        }
    });
});

await app.RunAsync();

static async Task EnsureRoutine2SchemaAsync(AppDbContext db)
{
    const string sql = """
IF COL_LENGTH(N'Activities', N'ClientRequestId') IS NULL
BEGIN
    ALTER TABLE [Activities] ADD [ClientRequestId] nvarchar(64) NULL;
END;

IF COL_LENGTH(N'Activities', N'ArchivedAt') IS NULL
BEGIN
    ALTER TABLE [Activities] ADD [ArchivedAt] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_Activities_UserId_ClientRequestId'
      AND object_id = OBJECT_ID(N'[Activities]')
)
BEGIN
    CREATE UNIQUE INDEX [IX_Activities_UserId_ClientRequestId]
        ON [Activities] ([UserId], [ClientRequestId])
        WHERE [ClientRequestId] IS NOT NULL;
END;

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
        CONSTRAINT [PK_RoutineTasks] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_RoutineTasks_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]),
        CONSTRAINT [FK_RoutineTasks_Activities_ActivityId] FOREIGN KEY ([ActivityId]) REFERENCES [Activities] ([Id]) ON DELETE SET NULL
    );

    CREATE INDEX [IX_RoutineTasks_UserId_DueDate] ON [RoutineTasks] ([UserId], [DueDate]);
    CREATE INDEX [IX_RoutineTasks_ActivityId] ON [RoutineTasks] ([ActivityId]);
    CREATE UNIQUE INDEX [IX_RoutineTasks_UserId_ClientRequestId]
        ON [RoutineTasks] ([UserId], [ClientRequestId])
        WHERE [ClientRequestId] IS NOT NULL;
END;

IF COL_LENGTH(N'RoutineTasks', N'CompletedAt') IS NULL
BEGIN
    ALTER TABLE [RoutineTasks] ADD [CompletedAt] datetime2 NULL;
END;

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
        CONSTRAINT [PK_ChecklistItems] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ChecklistItems_RoutineTasks_TaskId] FOREIGN KEY ([TaskId]) REFERENCES [RoutineTasks] ([Id]) ON DELETE CASCADE
    );

    CREATE INDEX [IX_ChecklistItems_TaskId_SortOrder] ON [ChecklistItems] ([TaskId], [SortOrder]);
END;
""";

    await db.Database.ExecuteSqlRawAsync(sql);
}