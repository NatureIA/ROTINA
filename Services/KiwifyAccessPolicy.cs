namespace Routine.Services;

/// <summary>
/// Compra única: a primeira aquisição concede sete dias iniciais de acesso,
/// seguidos por doze meses de calendário. Renovações antecipadas acrescentam
/// doze meses ao vencimento existente; após expirar, começam na nova compra.
/// </summary>
public static class KiwifyAccessPolicy
{
    public static DateTime CalculateExpiryUtc(
        DateTime purchaseApprovedUtc,
        bool previousPurchaseExists,
        DateTime? currentValidExpiryUtc,
        int initialDays = 7,
        int accessMonths = 12)
    {
        if (purchaseApprovedUtc.Kind != DateTimeKind.Utc)
            throw new ArgumentException("A data da compra deve estar em UTC.", nameof(purchaseApprovedUtc));
        if (initialDays != 7 || accessMonths != 12)
            throw new ArgumentOutOfRangeException(nameof(accessMonths), "O produto exige sete dias iniciais e doze meses.");

        if (!previousPurchaseExists)
            return purchaseApprovedUtc.AddDays(initialDays).AddMonths(accessMonths);

        var cycleStart = currentValidExpiryUtc.HasValue && currentValidExpiryUtc.Value > purchaseApprovedUtc
            ? currentValidExpiryUtc.Value
            : purchaseApprovedUtc;

        return cycleStart.AddMonths(accessMonths);
    }
}
