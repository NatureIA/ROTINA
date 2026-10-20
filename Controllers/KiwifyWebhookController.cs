using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Routine.Data;
using Routine.Models;
using Routine.Security;
using Routine.Services;

namespace Routine.Controllers;

[ApiController]
[Route("api/integrations/kiwify/webhook")]
[AllowAnonymous]
public class KiwifyWebhookController(
    AppDbContext db,
    IConfiguration configuration,
    IKiwifyWelcomeEmailSender welcomeSender,
    ILogger<KiwifyWebhookController> logger) : ControllerBase
{
    private const string Approved = "order_approved";
    private const string Renewed = "subscription_renewed";
    private const string Refunded = "order_refunded";
    private const string Chargedback = "chargeback";
    private const string Late = "subscription_late";
    private const string Canceled = "subscription_canceled";

    [HttpPost]
    [RequestSizeLimit(65536)]
    public async Task<IActionResult> Receive(CancellationToken cancellationToken)
    {
        if (!configuration.GetValue<bool>("Kiwify:Enabled"))
            return StatusCode(503, new { message = "Integração ainda não habilitada." });

        var secret = configuration["Kiwify:WebhookToken"];
        var expectedProduct = configuration["Kiwify:ProductId"];
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 24 ||
            string.IsNullOrWhiteSpace(expectedProduct))
            return StatusCode(503, new { message = "Integração ainda não configurada." });

        // Kiwify Sales Webhooks: signature=HMAC-SHA1(JSON.stringify(body), token)
        // A Banking API possui um protocolo diferente e não é utilizada nesta integração.
        var signature = Request.Query["signature"].ToString();
        if (signature.Length != 40 || !signature.All(Uri.IsHexDigit))
            return Unauthorized(new { message = "Assinatura inválida." });

        string body;
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8))
            body = await reader.ReadToEndAsync(cancellationToken);

        JsonDocument document;
        try { document = JsonDocument.Parse(body); }
        catch (JsonException) { return BadRequest(new { message = "JSON inválido." }); }

        using (document)
        {
            var root = document.RootElement;
            var compact = JsonSerializer.Serialize(root,
                new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            if (!ValidateSignature(secret, signature, body) &&
                !ValidateSignature(secret, signature, compact))
                return Unauthorized(new { message = "Assinatura inválida." });

            var product = Text(Nested(root, "Product"), "product_id");
            if (!string.Equals(product, expectedProduct, StringComparison.Ordinal))
                return Ok(new { status = "ignored_product" });

            var eventType = Text(root, "webhook_event_type").ToLowerInvariant() switch
            {
                "compra_aprovada" => Approved,
                "compra_reembolsada" => Refunded,
                "order_refunded" => Refunded,
                "subscription_cancelled" => Canceled,
                "order_chargedback" => Chargedback,
                "order_chargeback" => Chargedback,
                var other => other
            };
            if (eventType is not (Approved or Renewed or Refunded or Chargedback or Late or Canceled))
                return Ok(new { status = "ignored_event" });

            var orderId = Text(root, "order_id");
            var subscriptionId = Text(root, "subscription_id");
            if (orderId.Length is 0 or > 120 || subscriptionId.Length > 120)
                return UnprocessableEntity(new { message = "Identificador de pedido inválido." });

            // A mesma cobrança pode gerar tanto compra aprovada quanto renovação.
            // A identificação abaixo impede aumentar o prazo duas vezes.
            var eventKey = ComputeEventKey(product, orderId,
                eventType is (Approved or Renewed) ? "paid" : eventType);

            if (await db.KiwifyWebhookReceipts.AsNoTracking()
                .AnyAsync(x => x.EventKey == eventKey, cancellationToken))
                return Ok(new { status = "duplicate" });

            var now = DateTime.UtcNow;
            var receipt = new KiwifyWebhookReceipt
            {
                ProductId = product, OrderId = orderId,
                SubscriptionId = string.IsNullOrWhiteSpace(subscriptionId) ? null : subscriptionId,
                EventType = eventType, EventKey = eventKey, ReceivedAtUtc = now
            };

            bool newlyCreated = false;
            string? recipient = null;
            Guid? userId = null;

            if (eventType is Approved or Renewed)
            {
                if (eventType == Approved && Text(root, "order_status") is not ("paid" or "approved"))
                    return UnprocessableEntity(new { message = "Compra ainda não confirmada." });

                var customer = Nested(root, "Customer");
                var email = Text(customer, "email").ToLowerInvariant();
                if (email.Length is 0 or > 80 || !MailAddress.TryCreate(email, out var addr) ||
                    !string.Equals(addr.Address, email, StringComparison.OrdinalIgnoreCase))
                    return UnprocessableEntity(new { message = "Comprador sem e-mail válido." });

                var subscription = !string.IsNullOrWhiteSpace(subscriptionId);
                var months = configuration.GetValue<int>(
                    subscription ? "Kiwify:SubscriptionCycleMonths" : "Kiwify:OneTimeAccessMonths");
                if (months is < 1 or > 36)
                    return StatusCode(503, new { message = "Prazo comercial ainda não configurado." });

                var user = await db.Users.FirstOrDefaultAsync(
                    x => x.NormalizedEmail == email, cancellationToken);
                if (user is null)
                {
                    if (eventType != Approved)
                        return Conflict(new { message = "Renovação aguardando compra inicial." });

                    user = new User
                    {
                        Id = Guid.NewGuid(), Login = email, Email = email, NormalizedEmail = email,
                        DisplayName = NormalizeName(Text(customer, "full_name")),
                        PasswordHash = PasswordTools.Hash(
                            Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))),
                        KiwifyManaged = true, CreatedAt = now
                    };
                    db.Users.Add(user);
                    newlyCreated = true;
                    recipient = email;
                }
                else if (string.IsNullOrWhiteSpace(user.DisplayName))
                {
                    user.DisplayName = NormalizeName(Text(customer, "full_name"));
                }

                userId = user.Id;
                var entitlement = subscription
                    ? await db.KiwifyEntitlements.FirstOrDefaultAsync(x =>
                        x.ProductId == product && x.SubscriptionId == subscriptionId, cancellationToken)
                    : await db.KiwifyEntitlements.FirstOrDefaultAsync(x =>
                        x.ProductId == product && x.OrderId == orderId, cancellationToken);

                if (entitlement is null)
                {
                    entitlement = new KiwifyEntitlement
                    {
                        Id = Guid.NewGuid(), UserId = user.Id, ProductId = product,
                        OrderId = orderId, SubscriptionId = subscription ? subscriptionId : null,
                        Status = "active", PaidThroughUtc = now.AddMonths(months), UpdatedAtUtc = now
                    };
                    db.KiwifyEntitlements.Add(entitlement);
                }
                else
                {
                    if (entitlement.UserId != user.Id)
                        return Conflict(new { message = "Assinatura vinculada a outra conta." });

                    // Uma devolução/chargeback não pode ser revertida pela entrega atrasada
                    // do mesmo pedido. Uma cobrança nova, com novo ID, pode reativar.
                    if (entitlement.Status is "refunded" or "chargeback" &&
                        entitlement.OrderId == orderId)
                        return Conflict(new { message = "Pedido reembolsado; revisão necessária." });

                    entitlement.PaidThroughUtc = (entitlement.PaidThroughUtc > now
                        ? entitlement.PaidThroughUtc : now).AddMonths(months);
                    entitlement.OrderId = orderId;
                    entitlement.Status = "active";
                    entitlement.UpdatedAtUtc = now;
                }
            }
            else
            {
                // Não inventar contas nem retirar acesso de um comprador distinto.
                var entitlement = !string.IsNullOrWhiteSpace(subscriptionId)
                    ? await db.KiwifyEntitlements.FirstOrDefaultAsync(x =>
                        x.ProductId == product && x.SubscriptionId == subscriptionId, cancellationToken)
                    : await db.KiwifyEntitlements.FirstOrDefaultAsync(x =>
                        x.ProductId == product && x.OrderId == orderId, cancellationToken);
                if (entitlement is null)
                    return Conflict(new { message = "Evento aguardando compra correspondente." });

                userId = entitlement.UserId;
                if (eventType is Refunded or Chargedback)
                {
                    entitlement.Status = eventType == Refunded ? "refunded" : "chargeback";
                    entitlement.PaidThroughUtc = now;
                }
                else if (entitlement.Status is not ("refunded" or "chargeback"))
                {
                    if (eventType == Canceled)
                        entitlement.Status = "canceled"; // manter prazo já pago
                    if (eventType == Late)
                    {
                        var grace = configuration.GetValue<int>("Kiwify:GraceDays");
                        if (grace is < 0 or > 30)
                            return StatusCode(503, new { message = "Tolerância não configurada." });
                        entitlement.Status = "late";
                        var graceEnd = now.AddDays(grace);
                        if (entitlement.PaidThroughUtc > graceEnd)
                            entitlement.PaidThroughUtc = graceEnd;
                    }
                }
                entitlement.UpdatedAtUtc = now;
            }

            receipt.UserId = userId;
            db.KiwifyWebhookReceipts.Add(receipt);

            // EF Core usa transação para alterações em múltiplas entidades no SQL Server.
            // Índices únicos impedem contas/pedidos/eventos duplicados sob concorrência.
            try { await db.SaveChangesAsync(cancellationToken); }
            catch (DbUpdateException ex)
            {
                logger.LogWarning(ex, "Kiwify: conflito de gravação para pedido {OrderId}.", orderId);
                return Conflict(new { message = "Evento em processamento; reenviar." });
            }

            if (newlyCreated && recipient is not null)
            {
                try { await welcomeSender.SendAsync(recipient, cancellationToken); }
                catch (Exception ex)
                {
                    // Comprador consegue ativar seu acesso pela área de membros.
                    logger.LogError(ex, "Falha ao enviar boas-vindas do ROUTINE para usuário {UserId}.", userId);
                }
            }

            return Ok(new { status = "processed" });
        }
    }

    private static string ComputeEventKey(string product, string order, string type) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{product}|{order}|{type}")));

    public static bool ValidateSignature(string secret, string received, string json)
    {
        if (received.Length != 40) return false;
        byte[] supplied;
        try { supplied = Convert.FromHexString(received); }
        catch (FormatException) { return false; }

        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var computed = hmac.ComputeHash(Encoding.UTF8.GetBytes(json));
        return CryptographicOperations.FixedTimeEquals(computed, supplied);
    }

    private static string NormalizeName(string name) =>
        string.IsNullOrWhiteSpace(name) ? string.Empty :
        name.Trim().Length <= 80 ? name.Trim() : name.Trim()[..80];

    private static JsonElement Nested(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var result)
            ? result : default;

    private static string Text(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var property)
            && property.ValueKind == JsonValueKind.String
            ? property.GetString()?.Trim() ?? string.Empty : string.Empty;
}
