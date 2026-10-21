using System.ComponentModel.DataAnnotations;

namespace Routine.Models;

// Somente contas criadas pela integração ficam sob controle comercial automático.
public class KiwifyEntitlement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    [MaxLength(120)] public string ProductId { get; set; } = string.Empty;
    [MaxLength(120)] public string OrderId { get; set; } = string.Empty;
    [MaxLength(120)] public string? SubscriptionId { get; set; }
    [MaxLength(24)] public string Status { get; set; } = "active";
    public DateTime PaidThroughUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

// Um evento Kiwify nunca deve executar duas vezes as mesmas mudanças.
public class KiwifyWebhookReceipt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(64)] public string EventKey { get; set; } = string.Empty;
    [MaxLength(64)] public string EventType { get; set; } = string.Empty;
    [MaxLength(120)] public string OrderId { get; set; } = string.Empty;
    [MaxLength(120)] public string? SubscriptionId { get; set; }
    [MaxLength(120)] public string ProductId { get; set; } = string.Empty;
    public Guid? UserId { get; set; }
    public DateTime ReceivedAtUtc { get; set; } = DateTime.UtcNow;
}


// Diagnóstico de eventos autenticados que não geraram compras.
// Não armazenar nome, e-mail, corpo do JSON, assinatura ou token.
public class KiwifyWebhookDiagnostic
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(40)] public string Outcome { get; set; } = string.Empty;
    [MaxLength(64)] public string EventType { get; set; } = string.Empty;
    [MaxLength(120)] public string ProductId { get; set; } = string.Empty;
    public DateTime ReceivedAtUtc { get; set; } = DateTime.UtcNow;
}
