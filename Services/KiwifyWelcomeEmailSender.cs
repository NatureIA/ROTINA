using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Routine.Services;

public interface IKiwifyWelcomeEmailSender
{
    Task SendAsync(string email, CancellationToken cancellationToken = default);
}

public sealed class KiwifyWelcomeEmailSender(IConfiguration configuration)
    : IKiwifyWelcomeEmailSender
{
    public async Task SendAsync(string email, CancellationToken cancellationToken = default)
    {
        var host = configuration["Smtp:Host"];
        var port = configuration.GetValue<int>("Smtp:Port");
        var username = configuration["Smtp:Username"];
        var password = configuration["Smtp:Password"];
        var from = configuration["Smtp:From"];
        if (string.IsNullOrWhiteSpace(host) || port != 465 ||
            string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password) ||
            string.IsNullOrWhiteSpace(from))
            throw new InvalidOperationException("SMTP ainda não configurado.");

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Suporte ROUTINE", from));
        message.To.Add(MailboxAddress.Parse(email));
        message.Subject = "ROUTINE | Seu acesso está pronto";
        message.Body = new BodyBuilder
        {
            TextBody = "Sua compra do ROUTINE foi confirmada.\n\n" +
                "Para ativar seu acesso, use o mesmo e-mail da compra em:\n" +
                "https://routine.runasp.net/recuperar-senha.html\n\n" +
                "Depois de definir a senha, acesse:\n" +
                "https://routine.runasp.net/login.html\n\n" +
                "Se precisar de ajuda: suporte@routineapp.com.br",
            HtmlBody = "<div style='font-family:Arial,sans-serif;max-width:540px;color:#252525'>" +
                "<h2>Bem-vindo ao ROUTINE</h2><p>Sua compra foi confirmada.</p>" +
                "<p>Use o <strong>mesmo e-mail da compra</strong> para definir sua senha.</p>" +
                "<p><a href='https://routine.runasp.net/recuperar-senha.html'>" +
                "Ativar meu acesso</a></p><p>Depois acesse " +
                "<a href='https://routine.runasp.net/login.html'>Entrar no ROUTINE</a>.</p>" +
                "<p>Suporte: suporte@routineapp.com.br</p></div>"
        }.ToMessageBody();

        using var smtp = new SmtpClient();
        await smtp.ConnectAsync(host, port, SecureSocketOptions.SslOnConnect, cancellationToken);
        await smtp.AuthenticateAsync(username, password, cancellationToken);
        await smtp.SendAsync(message, cancellationToken);
        await smtp.DisconnectAsync(true, cancellationToken);
    }
}
