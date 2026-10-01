using System.Security.Cryptography;

namespace Routine.Security;

public static class PasswordTools
{
    private const int Iterations = 120_000;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(key)}";
    }

    public static bool Verify(string password, string stored)
    {
        try
        {
            var p = stored.Split('.');
            if (p.Length != 3) return false;
            var salt = Convert.FromBase64String(p[1]);
            var expected = Convert.FromBase64String(p[2]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, int.Parse(p[0]), HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch { return false; }
    }
}