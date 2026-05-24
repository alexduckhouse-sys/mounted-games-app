using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Auth;

public class TokenService
{
    private readonly IConfiguration _config;
    private readonly UserManager<AppUser> _users;

    public TokenService(IConfiguration config, UserManager<AppUser> users)
    {
        _config = config;
        _users = users;
    }

    public async Task<(string token, DateTime expiresAt, IList<string> roles)> CreateTokenAsync(AppUser user)
    {
        var key = _config["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key not configured");
        var issuer = _config["Jwt:Issuer"] ?? "MountedGames.Api";
        var audience = _config["Jwt:Audience"] ?? "MountedGames.Web";
        var minutes = int.TryParse(_config["Jwt:ExpiryMinutes"], out var m) ? m : 60 * 24;

        var roles = await _users.GetRolesAsync(user);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id),
            new(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
            new("fullName", user.FullName),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        if (user.ClubId.HasValue)
            claims.Add(new Claim("clubId", user.ClubId.Value.ToString()));
        foreach (var r in roles)
            claims.Add(new Claim(ClaimTypes.Role, r));

        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var expiresAt = DateTime.UtcNow.AddMinutes(minutes);
        var jwt = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: creds);

        return (new JwtSecurityTokenHandler().WriteToken(jwt), expiresAt, roles);
    }
}
