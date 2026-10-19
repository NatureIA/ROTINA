using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Routine.Controllers;
using Routine.Data;
using Routine.Models;
using Routine.Security;
using Xunit;

namespace Routine.Tests;

public class AuthControllerTests
{
    [Fact]
    public async Task Login_WithEmail_IsCaseInsensitive()
    {
        await using var db = CreateDb();
        db.Users.Add(new User
        {
            Login = "usuario@exemplo.com",
            Email = "usuario@exemplo.com",
            NormalizedEmail = "usuario@exemplo.com",
            PasswordHash = PasswordTools.Hash("SenhaForte123!")
        });
        await db.SaveChangesAsync();

        var controller = new AuthController(db, CreateConfiguration());
        var result = await controller.Login(new LoginRequest(
            "USUARIO@EXEMPLO.COM",
            "SenhaForte123!"));

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<LoginResponse>(ok.Value);
        Assert.Equal("usuario@exemplo.com", response.Email);
        Assert.False(string.IsNullOrWhiteSpace(response.Token));
    }

    [Fact]
    public async Task Login_LegacyAccountWithoutEmail_RemainsCompatible()
    {
        await using var db = CreateDb();
        db.Users.Add(new User
        {
            Login = "acesso1",
            Email = null,
            NormalizedEmail = null,
            PasswordHash = PasswordTools.Hash("SenhaForte123!")
        });
        await db.SaveChangesAsync();

        var controller = new AuthController(db, CreateConfiguration());
        var result = await controller.Login(new LoginRequest(
            "acesso1",
            "SenhaForte123!"));

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<LoginResponse>(ok.Value);
        Assert.Equal("acesso1", response.Email);
    }

    [Fact]
    public async Task Login_WithWrongPassword_IsRejected()
    {
        await using var db = CreateDb();
        db.Users.Add(new User
        {
            Login = "usuario@exemplo.com",
            Email = "usuario@exemplo.com",
            NormalizedEmail = "usuario@exemplo.com",
            PasswordHash = PasswordTools.Hash("SenhaCorreta123!")
        });
        await db.SaveChangesAsync();

        var controller = new AuthController(db, CreateConfiguration());
        var result = await controller.Login(new LoginRequest(
            "usuario@exemplo.com",
            "SenhaErrada"));

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task Me_DisplaysNameWhileKeepingEmailAsLoginIdentifier()
    {
        await using var db = CreateDb();
        var user = new User
        {
            Login = "victor@exemplo.com",
            Email = "victor@exemplo.com",
            NormalizedEmail = "victor@exemplo.com",
            DisplayName = "Victor",
            PasswordHash = PasswordTools.Hash("SenhaForte123!")
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var controller = CreateAuthenticatedController(db, user.Id);
        var response = await controller.Me();
        var ok = Assert.IsType<OkObjectResult>(response);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));

        Assert.Equal("Victor", json.RootElement.GetProperty("login").GetString());
        Assert.Equal("victor@exemplo.com", json.RootElement.GetProperty("email").GetString());

        var login = await controller.Login(new LoginRequest("victor@exemplo.com", "SenhaForte123!"));
        Assert.IsType<OkObjectResult>(login);
    }

    [Fact]
    public async Task Me_ExistingAccountWithoutDisplayNameRemainsCompatible()
    {
        await using var db = CreateDb();
        var user = new User
        {
            Login = "usuario@exemplo.com",
            Email = "usuario@exemplo.com",
            NormalizedEmail = "usuario@exemplo.com",
            PasswordHash = PasswordTools.Hash("SenhaForte123!")
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var controller = CreateAuthenticatedController(db, user.Id);
        var response = await controller.Me();
        var ok = Assert.IsType<OkObjectResult>(response);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));

        Assert.Equal("usuario@exemplo.com", json.RootElement.GetProperty("login").GetString());
    }

    private static AuthController CreateAuthenticatedController(AppDbContext db, Guid userId)
    {
        var controller = new AuthController(db, CreateConfiguration());
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "test"))
            }
        };
        return controller;
    }

    private static AppDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options);
    }

    private static IConfiguration CreateConfiguration()
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "routine-tests-jwt-key-with-more-than-32-chars",
                ["Jwt:Issuer"] = "routine-tests",
                ["Jwt:Audience"] = "routine-tests"
            })
            .Build();
    }
}
