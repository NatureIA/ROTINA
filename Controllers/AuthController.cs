using System.IdentityModel.Tokens.Jwt;
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
        var login = (request.Login ?? string.Empty).Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(x => x.Login.ToLower() == login);
        if (user is null || !PasswordTools.Verify(request.Password ?? string.Empty, user.PasswordHash))
            return Unauthorized(new { message = "Login ou senha inválidos." });

        var key = config["Jwt:Key"] ?? string.Empty;
        if (key.Length < 32) return StatusCode(500, new { message = "JWT não configurado no servidor." });

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Login),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"],
            audience: config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: credentials);

        return Ok(new LoginResponse(new JwtSecurityTokenHandler().WriteToken(token), user.Login));
    }

    [HttpGet("me")]
    [Authorize]
    public IActionResult Me() => Ok(new {
        id = User.FindFirstValue(ClaimTypes.NameIdentifier),
        login = User.Identity?.Name
    });
}