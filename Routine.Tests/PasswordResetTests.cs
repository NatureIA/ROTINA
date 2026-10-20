using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Routine.Controllers;
using Routine.Data;
using Routine.Models;
using Routine.Security;
using Routine.Services;
using Xunit;

namespace Routine.Tests;

public class PasswordResetTests
{
    [Fact]
    public async Task RequestSendsLinkWithHashedTokenAndResetRevokesSessions()
    {
        await using var db = CreateDb();
        var account = new User
        {
            Login = "pessoa@exemplo.com",
            Email = "pessoa@exemplo.com",
            NormalizedEmail = "pessoa@exemplo.com",
            DisplayName = "Pessoa",
            PasswordHash = PasswordTools.Hash("SenhaAntigaForte1")
        };
        db.Users.Add(account);
        await db.SaveChangesAsync();

        var sender = new FakeSender();
        var controller = Controller(db, sender);
        Assert.IsType<OkObjectResult>(
            await controller.Forgot(new ForgotPasswordRequest("PESSOA@EXEMPLO.COM"), CancellationToken.None));

        Assert.NotNull(sender.Link);
        Assert.StartsWith("https://routine.runasp.net/redefinir-senha.html#token=", sender.Link);
        var token = new Uri(sender.Link).Fragment["#token=".Length..];
        var entry = Assert.Single(db.PasswordResetTokens);
        Assert.DoesNotContain(token, entry.TokenHash);
        Assert.Equal(64, entry.TokenHash.Length);
        Assert.True(entry.ExpiresAt > DateTime.UtcNow);

        var result = await controller.Reset(new ResetPasswordRequest(token, "NovaSenhaForte123!"), CancellationToken.None);
        Assert.IsType<OkObjectResult>(result);
        Assert.True(PasswordTools.Verify("NovaSenhaForte123!", account.PasswordHash));
        Assert.False(PasswordTools.Verify("SenhaAntigaForte1", account.PasswordHash));
        Assert.Equal(1, account.SessionVersion);
        Assert.NotNull(entry.UsedAt);

        var replay = await controller.Reset(
            new ResetPasswordRequest(token, "OutraSenhaForte123!"), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(replay);
        Assert.Equal(1, account.SessionVersion);
        Assert.Equal("Pessoa", account.DisplayName);
    }

    [Fact]
    public async Task UnknownEmailRespondsGenericallyWithoutSending()
    {
        await using var db = CreateDb();
        var sender = new FakeSender();
        var controller = Controller(db, sender);
        var result = await controller.Forgot(
            new ForgotPasswordRequest("desconhecido@exemplo.com"), CancellationToken.None);
        Assert.IsType<OkObjectResult>(result);
        Assert.Null(sender.Link);
        Assert.Empty(db.PasswordResetTokens);
    }

    [Fact]
    public async Task RepeatedRequestsDoNotGenerateMultipleActiveLinks()
    {
        await using var db = CreateDb();
        db.Users.Add(new User
        {
            Login = "usuario@exemplo.com",
            Email = "usuario@exemplo.com",
            NormalizedEmail = "usuario@exemplo.com",
            PasswordHash = PasswordTools.Hash("SenhaInicial123!")
        });
        await db.SaveChangesAsync();

        var sender = new FakeSender();
        var controller = Controller(db, sender);
        await controller.Forgot(new ForgotPasswordRequest("usuario@exemplo.com"), CancellationToken.None);
        await controller.Forgot(new ForgotPasswordRequest("usuario@exemplo.com"), CancellationToken.None);
        Assert.Equal(1, sender.Calls);
        Assert.Single(db.PasswordResetTokens);
    }

    [Fact]
    public async Task ExpiredLinkAndShortPasswordAreRejected()
    {
        await using var db = CreateDb();
        var user = new User
        {
            Login = "usuario@exemplo.com",
            Email = "usuario@exemplo.com",
            NormalizedEmail = "usuario@exemplo.com",
            PasswordHash = PasswordTools.Hash("SenhaInicial123!")
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var sender = new FakeSender();
        var controller = Controller(db, sender);
        await controller.Forgot(new ForgotPasswordRequest("usuario@exemplo.com"), CancellationToken.None);
        var token = new Uri(sender.Link!).Fragment["#token=".Length..];

        Assert.IsType<BadRequestObjectResult>(
            await controller.Reset(new ResetPasswordRequest(token, "123"), CancellationToken.None));

        var entry = Assert.Single(db.PasswordResetTokens);
        entry.ExpiresAt = DateTime.UtcNow.AddSeconds(-1);
        await db.SaveChangesAsync();
        Assert.IsType<BadRequestObjectResult>(
            await controller.Reset(new ResetPasswordRequest(token, "NovaSenhaForte123!"), CancellationToken.None));
        Assert.Equal(0, user.SessionVersion);
        Assert.True(PasswordTools.Verify("SenhaInicial123!", user.PasswordHash));
    }

    [Fact]
    public async Task FailedDeliveryDoesNotLeaveActiveRecoveryLink()
    {
        await using var db = CreateDb();
        db.Users.Add(new User
        {
            Login = "usuario@exemplo.com",
            Email = "usuario@exemplo.com",
            NormalizedEmail = "usuario@exemplo.com",
            PasswordHash = PasswordTools.Hash("SenhaInicial123!")
        });
        await db.SaveChangesAsync();

        var sender = new FakeSender { ThrowOnSend = true };
        var controller = Controller(db, sender);
        Assert.IsType<OkObjectResult>(
            await controller.Forgot(new ForgotPasswordRequest("usuario@exemplo.com"), CancellationToken.None));
        Assert.Empty(db.PasswordResetTokens);
    }

    private static PasswordResetController Controller(AppDbContext db, FakeSender sender)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PasswordReset:BaseUrl"] = "https://routine.runasp.net"
            })
            .Build();
        return new PasswordResetController(
            db, configuration, sender, NullLogger<PasswordResetController>.Instance);
    }

    private static AppDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private sealed class FakeSender : IPasswordResetEmailSender
    {
        public string? Link { get; private set; }
        public int Calls { get; private set; }
        public bool ThrowOnSend { get; set; }

        public Task SendAsync(string recipient, string link, CancellationToken cancellationToken = default)
        {
            Calls++;
            if (ThrowOnSend) throw new InvalidOperationException("SMTP indisponível");
            Link = link;
            return Task.CompletedTask;
        }
    }
}
