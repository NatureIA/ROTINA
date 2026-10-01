using System.Security.Claims;
using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Routine.Data;
using Routine.Models;

namespace Routine.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public class RoutineController(AppDbContext db) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("activities")]
    public async Task<IActionResult> Activities() =>
        Ok(await db.Activities.Where(x => x.UserId == UserId).OrderBy(x => x.Time).ToListAsync());

    [HttpPost("activities")]
    public async Task<IActionResult> CreateActivity(Activity input)
    {
        Normalize(input);
        input.Id = Guid.NewGuid();
        input.UserId = UserId;
        input.User = null;
        input.Executions = new List<Execution>();
        input.CreatedAt = DateTime.UtcNow;
        db.Activities.Add(input);
        await db.SaveChangesAsync();
        return Ok(input);
    }

    [HttpPut("activities/{id:guid}")]
    public async Task<IActionResult> UpdateActivity(Guid id, Activity input)
    {
        var item = await db.Activities.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (item is null) return NotFound();
        Normalize(input);
        item.Title = input.Title; item.Category = input.Category; item.Time = input.Time;
        item.DurationMinutes = input.DurationMinutes; item.Weight = input.Weight;
        item.Priority = input.Priority; item.Type = input.Type; item.Days = input.Days;
        item.StartDate = input.StartDate; item.EndDate = input.EndDate;
        item.Notes = input.Notes; item.Active = input.Active;
        await db.SaveChangesAsync();
        return Ok(item);
    }

    [HttpDelete("activities/{id:guid}")]
    public async Task<IActionResult> DeleteActivity(Guid id)
    {
        var item = await db.Activities.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (item is null) return NotFound();
        db.Activities.Remove(item);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("executions")]
    public async Task<IActionResult> Executions([FromQuery] string? from, [FromQuery] string? to)
    {
        var start = string.IsNullOrWhiteSpace(from) ? DateTime.UtcNow.AddDays(-180).ToString("yyyy-MM-dd") : from;
        var end = string.IsNullOrWhiteSpace(to) ? DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd") : to;
        return Ok(await db.Executions
            .Where(x => x.UserId == UserId && string.Compare(x.Date, start) >= 0 && string.Compare(x.Date, end) <= 0)
            .OrderByDescending(x => x.Date).ThenByDescending(x => x.UpdatedAt).ToListAsync());
    }

    [HttpPut("executions/{activityId:guid}/{date}")]
    public async Task<IActionResult> SetExecution(Guid activityId, string date, ExecutionRequest request)
    {
        var valid = new[] { "pending", "progress", "done", "skipped" };
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) || !valid.Contains(request.Status))
            return BadRequest(new { message = "Execução inválida." });

        if (!await db.Activities.AnyAsync(x => x.Id == activityId && x.UserId == UserId)) return NotFound();

        var item = await db.Executions.FirstOrDefaultAsync(x => x.UserId == UserId && x.ActivityId == activityId && x.Date == date);

        if (request.Status == "pending")
        {
            if (item is not null) { db.Executions.Remove(item); await db.SaveChangesAsync(); }
            return Ok(new { status = "pending" });
        }

        if (item is null)
        {
            item = new Execution { Id = Guid.NewGuid(), UserId = UserId, ActivityId = activityId, Date = date, Status = request.Status, UpdatedAt = DateTime.UtcNow };
            db.Executions.Add(item);
        }
        else { item.Status = request.Status; item.UpdatedAt = DateTime.UtcNow; }

        await db.SaveChangesAsync();
        return Ok(item);
    }

    private static void Normalize(Activity item)
    {
        item.Title = (item.Title ?? string.Empty).Trim();
        item.Category = string.IsNullOrWhiteSpace(item.Category) ? "Pessoal" : item.Category.Trim();
        item.Time = string.IsNullOrWhiteSpace(item.Time) ? "09:00" : item.Time.Trim();
        item.DurationMinutes = Math.Clamp(item.DurationMinutes, 5, 720);
        item.Weight = Math.Clamp(item.Weight, 1, 5);
        item.Priority = new[] { "low", "medium", "high" }.Contains(item.Priority) ? item.Priority : "medium";
        item.Type = new[] { "routine", "habit" }.Contains(item.Type) ? item.Type : "routine";
        item.Days = string.IsNullOrWhiteSpace(item.Days) ? "1,2,3,4,5" : item.Days;
        item.Notes = string.IsNullOrWhiteSpace(item.Notes) ? null : item.Notes.Trim();
    }
}