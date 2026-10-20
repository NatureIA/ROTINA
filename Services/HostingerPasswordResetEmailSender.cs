using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Routine.Services;

public interface IPasswordResetEmailSender
{
    Task SendAsync(string recipient, string link, CancellationToken cancellationToken = default);
}

public class HostingerPasswordResetEmailSender(IConfiguration configuration) : IPasswordResetEmailSender
{
    public async Task SendAsync(string recipient, string link, CancellationToken cancellationToken = default)
    {
        var host = configuration["Smtp:Host"];
        var port = configuration.GetValue<int>("Smtp:Port");
        var username = configuration["Smtp:Username"];
        var password = configuration["Smtp:Password"];
        var from = configuration["Smtp:From"];

        if (string.IsNullOrWhiteSpace(host) || port != 465 ||
            string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password) ||
            string.IsNullOrWhiteSpace(from))
            throw new InvalidOperationException("Configuração SMTP ausente ou inválida.");

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Suporte ROUTINE", from));
        message.To.Add(MailboxAddress.Parse(recipient));
        message.Subject = "ROUTINE | Redefinição de senha";

        var safeLink = System.Net.WebUtility.HtmlEncode(link);
        var body = new BodyBuilder
        {
            TextBody = "Recebemos um pedido de redefinição de senha do ROUTINE.\n\n" +
                       "Use este link em até 15 minutos: " + link + "\n\n" +
                       "Se não solicitou a alteração, ignore esta mensagem.",
            HtmlBody = "<div style='font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222'>" +
                       "<h2>ROUTINE</h2><p>Recebemos um pedido de redefinição de senha.</p>" +
                       "<p><a href='" + safeLink + "' style='display:inline-block;padding:12px 20px;background:#ee741a;" +
                       "color:white;text-decoration:none;border-radius:8px'>Definir nova senha</a></p>" +
                       "<p>O link expira em 15 minutos e só pode ser utilizado uma vez.</p>" +
                       "<p>Se não foi você, ignore esta mensagem.</p></div>"
        };
        message.Body = body.ToMessageBody();

        using var client = new SmtpClient();
        await client.ConnectAsync(host, port, SecureSocketOptions.SslOnConnect, cancellationToken);
        await client.AuthenticateAsync(username, password, cancellationToken);
        await client.SendAsync(message, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }
}
