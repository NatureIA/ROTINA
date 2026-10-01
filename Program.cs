using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
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

app.UseDefaultFiles(new DefaultFilesOptions { DefaultFileNames = new List<string> { "login.html" } });
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", app = "ROUTINE" }));
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
        }
        catch (Exception ex)
        {
            app.Logger.LogError(ex, "Falha ao inicializar o banco/usuários.");
        }
    });
});

await app.RunAsync();
