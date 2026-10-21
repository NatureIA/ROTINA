using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Routine.Controllers;
using Routine.Data;
using Routine.Models;
using Routine.Services;
using Xunit;

namespace Routine.Tests;

/// <summary>
/// Homologação local contra banco relacional SQL SQLite efêmero.
/// NUNCA usa SQL de produção, SMTP real, dados de compradores ou token real.
/// </summary>
public class KiwifyFullFlowTests
{
    private const string ProductId = "b537da80-c888-11f1-b0f5-37ff8e851a7d";
    private const string FakeToken = "fakeOnlyABC";
    private const string CustomerEmail = "homologacao@exemplo.invalid";
    private const string Password = "SenhaTemporariaForte123!";

    [Fact]
    public async Task FullPurchaseActivationRenewalExpiryAndRefundCycle_UsesIsolatedRelationalDatabase()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var config = Configuration();
        var welcome = new FakeWelcomeEmail();
        var resetEmail = new FakeResetEmail();
        var receiver = new KiwifyWebhookController(db, config, welcome,
            NullLogger<KiwifyWebhookController>.Instance);
        var auth = new AuthController(db, config);
        var password = new PasswordResetController(db, config, resetEmail,
            NullLogger<PasswordResetController>.Instance);

        // Payload corresponde aos campos documentados pela Kiwify (compra única).
        var firstPayload = SalesPayload("pedido-homologacao-1");
        var first = await Deliver(receiver, firstPayload);
        Assert.IsType<OkObjectResult>(first);
        var user = Assert.Single(await db.Users.ToListAsync());
        Assert.True(user.KiwifyManaged);
        Assert.Equal(CustomerEmail, user.NormalizedEmail);
        Assert.Equal("Cliente Homologação", user.DisplayName);
        Assert.Equal(CustomerEmail, Assert.Single(welcome.Recipients));
        Assert.Single(await db.KiwifyWebhookReceipts.ToListAsync());
        Assert.Single(await db.KiwifyEntitlements.ToListAsync());

        var entitlement = Assert.Single(await db.KiwifyEntitlements.ToListAsync());
        var receipt = Assert.Single(await db.KiwifyWebhookReceipts.ToListAsync());
        var expectedExpiry = receipt.ReceivedAtUtc.AddDays(7).AddMonths(12);
        Assert.Equal(expectedExpiry, entitlement.PaidThroughUtc);
        Assert.True(entitlement.PaidThroughUtc > DateTime.UtcNow);

        // A senha aleatória inicial não permite autenticação sem ativação.
        Assert.IsType<UnauthorizedObjectResult>(
            await auth.Login(new LoginRequest(CustomerEmail, Password)));

        // Fluxo real de recuperação/primeira senha, com envio de e-mail substituído por fake.
        Assert.IsType<OkObjectResult>(
            await password.Forgot(new ForgotPasswordRequest(CustomerEmail), CancellationToken.None));
        Assert.Single(resetEmail.Links);
        var token = new Uri(resetEmail.Links[0]).Fragment["#token=".Length..];
        Assert.Equal(43, token.Length);
        Assert.IsType<OkObjectResult>(
            await password.Reset(new ResetPasswordRequest(token, Password), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(
            await password.Reset(new ResetPasswordRequest(token, Password), CancellationToken.None));
        Assert.IsType<OkObjectResult>(await auth.Login(new LoginRequest(CustomerEmail, Password)));

        // Reenvio exato pela Kiwify não duplica usuário, compra ou e-mail.
        Assert.IsType<OkObjectResult>(await Deliver(receiver, firstPayload));
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(1, await db.KiwifyEntitlements.CountAsync());
        Assert.Equal(1, welcome.Recipients.Count);

        // Nova compra do mesmo e-mail adiciona 12 meses ao vencimento, sem novo bônus inicial.
        var renewal = await Deliver(receiver, SalesPayload("pedido-homologacao-2"));
        Assert.IsType<OkObjectResult>(renewal);
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(2, await db.KiwifyEntitlements.CountAsync());
        var second = await db.KiwifyEntitlements.SingleAsync(x => x.OrderId == "pedido-homologacao-2");
        Assert.Equal(expectedExpiry.AddMonths(12), second.PaidThroughUtc);

        // Bloqueio ao vencimento de todos os direitos. A conta e o histórico permanecem.
        var all = await db.KiwifyEntitlements.ToListAsync();
        foreach (var item in all) item.PaidThroughUtc = DateTime.UtcNow.AddDays(-1);
        await db.SaveChangesAsync();
        var expired = await auth.Login(new LoginRequest(CustomerEmail, Password));
        var forbidden = Assert.IsType<ObjectResult>(expired);
        Assert.Equal(403, forbidden.StatusCode);
        Assert.Equal(1, await db.Users.CountAsync());

        // Recompra após vencimento reabre acesso pela mesma conta.
        Assert.IsType<OkObjectResult>(
            await Deliver(receiver, SalesPayload("pedido-homologacao-3")));
        Assert.IsType<OkObjectResult>(await auth.Login(new LoginRequest(CustomerEmail, Password)));
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(3, await db.KiwifyEntitlements.CountAsync());

        // Reembolso da última compra: bloquear novamente; não apagar dados.
        Assert.IsType<OkObjectResult>(
            await Deliver(receiver, SalesPayload("pedido-homologacao-3", "order_refunded")));
        var afterRefund = Assert.IsType<ObjectResult>(
            await auth.Login(new LoginRequest(CustomerEmail, Password)));
        Assert.Equal(403, afterRefund.StatusCode);
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(3, await db.KiwifyEntitlements.CountAsync());
        Assert.Equal(4, await db.KiwifyWebhookReceipts.CountAsync());
    }

    [Fact]
    public async Task FourPermanentUsersCannotBeConvertedOrSuspendedByPurchaseOrRefund()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var config = Configuration();
        var receiver = new KiwifyWebhookController(db, config, new FakeWelcomeEmail(),
            NullLogger<KiwifyWebhookController>.Instance);
        var auth = new AuthController(db, config);

        foreach (var (name, email) in new[] {
            ("João", "joao@exemplo.invalid"), ("Victor", "victor@exemplo.invalid"),
            ("Jeferson", "jeferson@exemplo.invalid"), ("Lara", "lara@exemplo.invalid")
        })
        {
            db.Users.Add(new User {
                Login = email, Email = email, NormalizedEmail = email,
                DisplayName = name, KiwifyManaged = false,
                PasswordHash = Routine.Security.PasswordTools.Hash(Password)
            });
        }
        await db.SaveChangesAsync();

        foreach (var legacy in await db.Users.ToListAsync())
        {
            var order = $"legacy-{legacy.Id:N}";
            Assert.IsType<OkObjectResult>(
                await Deliver(receiver, SalesPayload(order, "order_approved", legacy.Email!)));
            Assert.IsType<OkObjectResult>(
                await Deliver(receiver, SalesPayload(order, "order_refunded", legacy.Email!)));
            Assert.False(legacy.KiwifyManaged);
            Assert.IsType<OkObjectResult>(
                await auth.Login(new LoginRequest(legacy.Email!, Password)));
        }
        Assert.Equal(4, await db.Users.CountAsync());
        Assert.All(await db.Users.ToListAsync(), user => Assert.False(user.KiwifyManaged));
    }

    [Fact]
    public async Task AValidSignatureWithDifferentProductIdNeverCreatesUserInRelationalDatabase()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var receiver = new KiwifyWebhookController(db, Configuration(), new FakeWelcomeEmail(),
            NullLogger<KiwifyWebhookController>.Instance);
        Assert.IsType<OkObjectResult>(
            await Deliver(receiver, SalesPayload("fake-product", productId: "another-product")));
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.KiwifyEntitlements.ToListAsync());
        Assert.Equal("ignored_product", (await db.KiwifyWebhookDiagnostics.SingleAsync()).Outcome);
    }

    private static IConfiguration Configuration() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Kiwify:Enabled"] = "true",
            ["Kiwify:WebhookToken"] = FakeToken,
            ["Kiwify:ProductId"] = ProductId,
            ["Kiwify:InitialDays"] = "7",
            ["Kiwify:OneTimeAccessMonths"] = "12",
            ["PasswordReset:BaseUrl"] = "https://routine.runasp.net",
            ["Jwt:Key"] = "chave-ficticia-de-homologacao-com-pelo-menos-32-bytes",
            ["Jwt:Issuer"] = "routine-tests",
            ["Jwt:Audience"] = "routine-tests"
        }).Build();

    private static string SalesPayload(string order, string eventType = "order_approved",
        string email = CustomerEmail, string productId = ProductId)
    {
        return JsonSerializer.Serialize(new {
            order_id = order,
            order_ref = "reference-test",
            order_status = "paid",
            payment_method = "credit_card",
            approved_date = "2026-10-21 14:00",
            product_type = "membership",
            webhook_event_type = eventType,
            Product = new { product_id = productId, product_name = "ROUTINE",
                product_offer_id = "offer-test", product_offer_name = "Oferta principal" },
            Customer = new { full_name = "Cliente Homologação", first_name = "Cliente",
                email = email, mobile = (string?)null, CPF = (string?)null }
        });
    }

    private static async Task<IActionResult> Deliver(KiwifyWebhookController receiver, string payload)
    {
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(FakeToken));
        var signature = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)))
            .ToLowerInvariant();
        receiver.ControllerContext = new ControllerContext {
            HttpContext = new DefaultHttpContext()
        };
        receiver.Request.QueryString = new QueryString("?signature=" + signature);
        receiver.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(payload));
        return await receiver.Receive(CancellationToken.None);
    }

    private sealed class FakeWelcomeEmail : IKiwifyWelcomeEmailSender
    {
        public List<string> Recipients { get; } = new();
        public Task SendAsync(string recipient, CancellationToken token = default)
        {
            Recipients.Add(recipient);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeResetEmail : IPasswordResetEmailSender
    {
        public List<string> Links { get; } = new();
        public Task SendAsync(string recipient, string link, CancellationToken token = default)
        {
            Links.Add(link);
            return Task.CompletedTask;
        }
    }
}
