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
