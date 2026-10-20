using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Routine.Data;
using Routine.Models;
using Routine.Security;
using Routine.Services;

namespace Routine.Controllers;

[ApiController]
[Route("api/auth/password")]
[AllowAnonymous]
[EnableRateLimiting("password-recovery")]
public class PasswordResetController(
    AppDbContext db,
    IConfiguration configuration,
    IPasswordResetEmailSender emailSender,
    ILogger<PasswordResetController> logger) : ControllerBase
{
    private const string PublicResponse =
        "Se o e-mail estiver cadastrado, enviaremos um link de recuperação.";

    [HttpPost("forgot")]
    public async Task<IActionResult> Forgot(ForgotPasswordRequest request, CancellationToken cancellationToken)
    {
        var candidate = (request.Email ?? string.Empty).Trim();
        if (candidate.Length > 254 ||
            !MailAddress.TryCreate(candidate, out var address) ||
            !string.Equals(address.Address, candidate, StringComparison.OrdinalIgnoreCase))
            return Ok(new { message = PublicResponse });

        var normalizedEmail = candidate.ToLowerInvariant();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(
            x => x.NormalizedEmail == normalizedEmail, cancellationToken);

        if (user is null || string.IsNullOrWhiteSpace(user.Email))
            return Ok(new { message = PublicResponse });

        var now = DateTime.UtcNow;
        // Impede o reenvio e a criação de múltiplos links durante a validade.
        var recentlySent = await db.PasswordResetTokens.AnyAsync(x =>
            x.UserId == user.Id && x.CreatedAt > now.AddMinutes(-15) &&
            x.UsedAt == null, cancellationToken);
        if (recentlySent)
            return Ok(new { message = PublicResponse });

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var entry = new PasswordResetToken
        {
            UserId = user.Id,
            TokenHash = HashToken(token),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(15)
        };
        db.PasswordResetTokens.Add(entry);
        await db.SaveChangesAsync(cancellationToken);

        try
        {
            // URL definida em configuração: nunca usar Host enviado pelo cliente.
            var baseUrl = configuration["PasswordReset:BaseUrl"] ?? "https://routine.runasp.net";
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var parsed) ||
                parsed.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(parsed.Query) ||
                !string.IsNullOrEmpty(parsed.Fragment))
                throw new InvalidOperationException("URL de recuperação não configurada corretamente.");

            var link = baseUrl.TrimEnd('/') + "/redefinir-senha.html#token=" + token;
            await emailSender.SendAsync(user.Email, link, cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Falha ao enviar e-mail de recuperação para o usuário {UserId}.", user.Id);
            db.PasswordResetTokens.Remove(entry);
            await db.SaveChangesAsync(CancellationToken.None);
        }

        return Ok(new { message = PublicResponse });
    }

    [HttpPost("reset")]
    public async Task<IActionResult> Reset(ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        var rawToken = request.Token ?? "";
        if (rawToken.Length != 43 || rawToken.Any(c =>
            !(char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_')))
            return BadRequest(new { message = "Link inválido ou expirado." });

        var password = request.NewPassword ?? "";
        if (password.Length < 12 || password.Length > 128)
            return BadRequest(new { message = "A nova senha deve conter entre 12 e 128 caracteres." });

        var hash = HashToken(rawToken);
        var now = DateTime.UtcNow;
        var token = await db.PasswordResetTokens.FirstOrDefaultAsync(
            x => x.TokenHash == hash, cancellationToken);
        if (token is null || token.UsedAt is not null || token.ExpiresAt <= now)
            return BadRequest(new { message = "Link inválido ou expirado." });

        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == token.UserId, cancellationToken);
        if (user is null)
            return BadRequest(new { message = "Link inválido ou expirado." });

        token.UsedAt = now;
        user.PasswordHash = PasswordTools.Hash(password);
        user.SessionVersion = checked(user.SessionVersion + 1);

        try
        {
            // UsedAt é um token de concorrência do EF: apenas um envio pode consumi-lo.
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return BadRequest(new { message = "Link inválido ou expirado." });
        }

        return Ok(new { message = "Senha redefinida. Você já pode entrar no ROUTINE." });
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
