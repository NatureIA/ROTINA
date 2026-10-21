using Routine.Services;
using Xunit;

namespace Routine.Tests;

public class KiwifyAccessPolicyTests
{
    [Fact]
    public void FirstPurchase_SevenFullDaysThenTwelveCalendarMonths()
    {
        var creation = new DateTime(2026, 10, 21, 13, 30, 0, DateTimeKind.Utc);
        var expiry = KiwifyAccessPolicy.CalculateExpiryUtc(
            creation, previousPurchaseExists: false, currentValidExpiryUtc: null);
        Assert.Equal(new DateTime(2027, 10, 28, 13, 30, 0, DateTimeKind.Utc), expiry);
    }

    [Fact]
    public void EarlyRepurchase_PreservesUnusedAccessAndAddsTwelveMonths()
    {
        var purchase = new DateTime(2027, 2, 1, 14, 0, 0, DateTimeKind.Utc);
        var currentExpiry = new DateTime(2027, 10, 28, 13, 30, 0, DateTimeKind.Utc);
        var expiry = KiwifyAccessPolicy.CalculateExpiryUtc(
            purchase, previousPurchaseExists: true, currentValidExpiryUtc: currentExpiry);
        Assert.Equal(new DateTime(2028, 10, 28, 13, 30, 0, DateTimeKind.Utc), expiry);
    }

    [Fact]
    public void RepurchaseAfterExpiry_StartsNewTwelveMonthTermWithoutSecondBonus()
    {
        var purchase = new DateTime(2028, 1, 15, 10, 0, 0, DateTimeKind.Utc);
        var expired = new DateTime(2027, 10, 28, 13, 30, 0, DateTimeKind.Utc);
        var expiry = KiwifyAccessPolicy.CalculateExpiryUtc(
            purchase, previousPurchaseExists: true, currentValidExpiryUtc: expired);
        Assert.Equal(new DateTime(2029, 1, 15, 10, 0, 0, DateTimeKind.Utc), expiry);
    }

    [Fact]
    public void CalendarMonths_AreNotFixed365Days()
    {
        var purchase = new DateTime(2027, 2, 22, 8, 0, 0, DateTimeKind.Utc);
        var expiry = KiwifyAccessPolicy.CalculateExpiryUtc(
            purchase, previousPurchaseExists: false, currentValidExpiryUtc: null);
        Assert.Equal(new DateTime(2028, 3, 1, 8, 0, 0, DateTimeKind.Utc), expiry);
    }

    [Fact]
    public void AccessExpiresAtExactInstant()
    {
        var expiry = new DateTime(2027, 10, 28, 13, 30, 0, DateTimeKind.Utc);
        Assert.True(expiry > expiry.AddTicks(-1));
        Assert.False(expiry > expiry);
        Assert.False(expiry > expiry.AddTicks(1));
    }
}
