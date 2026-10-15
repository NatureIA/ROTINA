using System.IdentityModel.Tokens.Jwt;
using System.Net.Mail;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Routine.Data;
using Routine.Models;
using Routine.Security;

namespace Routine.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AppDbContext db, IConfiguration config) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var identifier = (request.Email ?? request.Login ?? string.Empty).Trim();
        var password = request.Password ?? string.Empty;

        User? user = null;

        if (TryNormalizeEmail(identifier, out var normalizedEmail))
        {
            user = await db.Users.FirstOrDefaultAsync(x => x.NormalizedEmail == normalizedEmail);
        }
        else
        {
            // Compatibilidade temporária apenas para contas antigas que ainda não receberam e-mail.
            var legacyLogin = identifier.ToLowerInvariant();
            user = await db.Users.FirstOrDefaultAsync(x =>
                x.NormalizedEmail == null &&
                x.Login.ToLower() == legacyLogin);
        }

        if (user is null || !PasswordTools.Verify(password, user.PasswordHash))
            return Unauthorized(new { message = "E-mail ou senha inválidos." });

        var identityEmail = user.Email ?? user.Login;

        var key = config["Jwt:Key"] ?? string.Empty;
        if (key.Length < 32)
            return StatusCode(500, new { message = "JWT não configurado no servidor." });

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, identityEmail),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        if (!string.IsNullOrWhiteSpace(user.Email))
            claims.Add(new Claim(ClaimTypes.Email, user.Email));

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"],
            audience: config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: credentials);

        return Ok(new LoginResponse(
            new JwtSecurityTokenHandler().WriteToken(token),
            identityEmail));
    }

    [HttpGet("me")]
    [Authorize]
    public IActionResult Me()
    {
        var identity = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name;

        return Ok(new
        {
            id = User.FindFirstValue(ClaimTypes.NameIdentifier),
            email = identity,
            login = identity
        });
    }

    private static bool TryNormalizeEmail(string value, out string normalized)
    {
        normalized = string.Empty;
        if (!MailAddress.TryCreate(value, out var address)) return false;
        if (!string.Equals(address.Address, value, StringComparison.OrdinalIgnoreCase)) return false;

        normalized = address.Address.Trim().ToLowerInvariant();
        return true;
    }
}
