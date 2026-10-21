using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
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

public class KiwifyWebhookTests
{
    private const string Secret = "rotina-kiwify-segredo-de-exemplo-1234567";
    private const string ProductId = "produto-routine-correto";

    [Fact]
    public async Task ApprovedCreatesManagedUserAndIsIdempotent()
    {
        await using var db = Database();
        var sender = new FakeSender();
        var controller = Controller(db, sender);
        var json = Message("order_approved", "order-1");
        var first = await Deliver(controller, json);
        Assert.IsType<OkObjectResult>(first);
        var account = Assert.Single(db.Users);
        Assert.Equal("Maria Silva", account.DisplayName);
        Assert.True(account.KiwifyManaged);
        Assert.Equal("maria@exemplo.com", account.NormalizedEmail);
        Assert.False(PasswordTools.Verify("123456789012", account.PasswordHash));
        Assert.True(Assert.Single(db.KiwifyEntitlements).PaidThroughUtc > DateTime.UtcNow.AddMonths(11));
        Assert.Single(db.KiwifyWebhookReceipts);
        Assert.Equal(1, sender.Calls);

        var replay = await Deliver(controller, json);
        Assert.IsType<OkObjectResult>(replay);
        Assert.Single(db.Users);
        Assert.Single(db.KiwifyEntitlements);
        Assert.Single(db.KiwifyWebhookReceipts);
        Assert.Equal(1, sender.Calls);
    }

    [Fact]
    public async Task InvalidSignatureDoesNotCreateUsers()
    {
        await using var db = Database();
        var controller = Controller(db, new FakeSender());
        var result = await Deliver(controller, Message("order_approved", "order-2"), "bad-signature");
        Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Empty(db.Users);
    }

    [Fact]
    public async Task WrongProductCannotCreateUser()
    {
        await using var db = Database();
        var controller = Controller(db, new FakeSender());
        var json = Message("order_approved", "order-3", "other-product");
        var result = await Deliver(controller, json);
        Assert.IsType<OkObjectResult>(result);
        Assert.Empty(db.Users);
    }

    [Fact]
    public async Task RefundBlocksPaidAccessWithoutDeletingData()
    {
        await using var db = Database();
        var sender = new FakeSender();
        var controller = Controller(db, sender);
        await Deliver(controller, Message("order_approved", "order-4"));
        var account = Assert.Single(db.Users);

        var refund = await Deliver(controller, Message("order_refunded", "order-4"));
        Assert.IsType<OkObjectResult>(refund);
        Assert.Equal("refunded", Assert.Single(db.KiwifyEntitlements).Status);
        Assert.True(Assert.Single(db.KiwifyEntitlements).PaidThroughUtc <= DateTime.UtcNow);
        Assert.NotNull(await db.Users.FindAsync(account.Id));
    }

    [Fact]
    public async Task NonPurchaseSubscriptionEventsAreIgnored()
    {
        await using var db = Database();
        var controller = Controller(db, new FakeSender());
        Assert.IsType<OkObjectResult>(
            await Deliver(controller, Message("subscription_renewed", "sub-order-2", ProductId, "sub-1")));
        Assert.Empty(db.Users);
        Assert.Empty(db.KiwifyEntitlements);
    }

    [Fact]
    public async Task ExistingAccountPasswordAndHistoricalAccessRemainUnchanged()
    {
        await using var db = Database();
        var user = new User
        {
            Login = "maria@exemplo.com", Email = "maria@exemplo.com",
            NormalizedEmail = "maria@exemplo.com", DisplayName = "Maria Original",
            PasswordHash = PasswordTools.Hash("SenhaOriginal123!")
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var sender = new FakeSender();
        var controller = Controller(db, sender);
        var response = await Deliver(controller, Message("order_approved", "order-5"));
        Assert.IsType<OkObjectResult>(response);
        Assert.Single(db.Users);
        Assert.False(user.KiwifyManaged);
        Assert.True(PasswordTools.Verify("SenhaOriginal123!", user.PasswordHash));
        Assert.Equal("Maria Original", user.DisplayName);
        Assert.Equal(0, sender.Calls);
        Assert.Equal(user.Id, Assert.Single(db.KiwifyEntitlements).UserId);
    }

    [Fact]
    public async Task NewPurchaseExtendsExistingPeriodAndRepeatedOrderDoesNot()
    {
        await using var db = Database();
        var controller = Controller(db, new FakeSender());
        await Deliver(controller, Message("order_approved", "order-10"));
        var before = Assert.Single(db.KiwifyEntitlements).PaidThroughUtc;

        var renewal = await Deliver(controller, Message("order_approved", "order-11"));
        Assert.IsType<OkObjectResult>(renewal);
        Assert.Equal(2, db.KiwifyEntitlements.Count());
        var newest = db.KiwifyEntitlements.Single(x => x.OrderId == "order-11");
        Assert.Equal(before.AddMonths(12), newest.PaidThroughUtc);

        var duplicate = await Deliver(controller, Message("order_approved", "order-11"));
        Assert.IsType<OkObjectResult>(duplicate);
        Assert.Equal(2, db.KiwifyEntitlements.Count());
        Assert.Equal(before.AddMonths(12), newest.PaidThroughUtc);
    }

    [Fact]
    public async Task DisabledConfigurationCannotProcessPayments()
    {
        await using var db = Database();
        var configuration = Settings(false);
        var sender = new FakeSender();
        var controller = new KiwifyWebhookController(db, configuration, sender,
            NullLogger<KiwifyWebhookController>.Instance);
        var result = await Deliver(controller, Message("order_approved", "order-9"));
        Assert.IsType<ObjectResult>(result);
        Assert.Empty(db.Users);
    }

    private static string Message(string eventType, string orderId,
        string productId = ProductId, string? subscriptionId = null)
    {
        return JsonSerializer.Serialize(new
        {
            order_id = orderId,
            order_status = "paid",
            webhook_event_type = eventType,
            subscription_id = subscriptionId,
            Product = new { product_id = productId, product_name = "ROUTINE" },
            Customer = new { full_name = "Maria Silva", email = "maria@exemplo.com" }
        });
    }

    private static async Task<IActionResult> Deliver(
        KiwifyWebhookController controller, string json, string? badSignature = null)
    {
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(Secret));
        var signature = badSignature ?? Convert.ToHexString(
            hmac.ComputeHash(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext()
        };
        controller.Request.QueryString = new QueryString("?signature=" + signature);
        controller.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(json));
        return await controller.Receive(CancellationToken.None);
    }

    private static IConfiguration Settings(bool enabled = true) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Kiwify:Enabled"] = enabled.ToString(),
            ["Kiwify:WebhookToken"] = Secret,
            ["Kiwify:ProductId"] = ProductId,
            ["Kiwify:OneTimeAccessMonths"] = "12",
            ["Kiwify:InitialDays"] = "7",
            ["Kiwify:SubscriptionCycleMonths"] = "1",
            ["Kiwify:GraceDays"] = "0"
        }).Build();

    private static KiwifyWebhookController Controller(AppDbContext db, FakeSender sender) =>
        new(db, Settings(), sender, NullLogger<KiwifyWebhookController>.Instance);

    private static AppDbContext Database() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private sealed class FakeSender : IKiwifyWelcomeEmailSender
    {
        public int Calls { get; private set; }
        public Task SendAsync(string email, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.CompletedTask;
        }
    }
}
