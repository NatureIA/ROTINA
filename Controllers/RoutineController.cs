using System.Globalization;
using System.Security.Claims;
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
    private static readonly string[] ValidExecutionStatuses = ["pending", "progress", "done", "skipped"];
    private static readonly string[] ValidTaskStatuses = ["pending", "progress", "done", "skipped"];
    private static readonly string[] ValidPriorities = ["low", "medium", "high"];

    [HttpGet("activities")]
    public async Task<IActionResult> Activities([FromQuery] bool includeArchived = false) =>
        Ok(await db.Activities.AsNoTracking()
            .Where(x => x.UserId == UserId && (includeArchived || x.ArchivedAt == null))
            .OrderBy(x => x.Time)
            .ToListAsync());

    [HttpPost("activities")]
    public async Task<IActionResult> CreateActivity(Activity input)
    {
        NormalizeActivity(input);
        if (string.IsNullOrWhiteSpace(input.Title))
            return BadRequest(new { message = "Informe o nome da atividade." });

        if (!string.IsNullOrWhiteSpace(input.ClientRequestId))
        {
            var byRequest = await db.Activities.AsNoTracking()
                .FirstOrDefaultAsync(x => x.UserId == UserId && x.ClientRequestId == input.ClientRequestId);
            if (byRequest is not null) return Ok(byRequest);
        }

        if (await HasDuplicateActivity(input))
            return Conflict(new { message = "Esta atividade já existe na sua rotina." });

        input.Id = Guid.NewGuid();
        input.UserId = UserId;
        input.User = null;
        input.Executions = new List<Execution>();
        input.Tasks = new List<RoutineTask>();
        input.CreatedAt = DateTime.UtcNow;

        db.Activities.Add(input);

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (!string.IsNullOrWhiteSpace(input.ClientRequestId))
        {
            var existing = await db.Activities.AsNoTracking()
                .FirstOrDefaultAsync(x => x.UserId == UserId && x.ClientRequestId == input.ClientRequestId);
            if (existing is not null) return Ok(existing);
            throw;
        }

        return Ok(input);
    }

    [HttpPut("activities/{id:guid}")]
    public async Task<IActionResult> UpdateActivity(Guid id, Activity input)
    {
        var item = await db.Activities.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId && x.ArchivedAt == null);
        if (item is null) return NotFound();

        NormalizeActivity(input);
        if (string.IsNullOrWhiteSpace(input.Title))
            return BadRequest(new { message = "Informe o nome da atividade." });

        if (await HasDuplicateActivity(input, id))
            return Conflict(new { message = "Já existe outra atividade com estes mesmos dados." });

        item.Title = input.Title;
        item.Category = input.Category;
        item.Time = input.Time;
        item.DurationMinutes = input.DurationMinutes;
        item.Weight = 1;
        item.Priority = input.Priority;
        item.Type = input.Type;
        item.Days = input.Days;
        item.StartDate = input.StartDate;
        item.EndDate = input.EndDate;
        item.Notes = input.Notes;
        item.Active = input.Active;

        await db.SaveChangesAsync();
        return Ok(item);
    }

    [HttpDelete("activities/{id:guid}")]
    public async Task<IActionResult> DeleteActivity(Guid id)
    {
        var item = await db.Activities.FirstOrDefaultAsync(
            x => x.Id == id && x.UserId == UserId && x.ArchivedAt == null);
        if (item is null) return NotFound();

        item.ArchivedWasActive = item.Active;
        item.Active = false;
        item.ArchivedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("executions")]
    public async Task<IActionResult> Executions([FromQuery] string? from, [FromQuery] string? to)
    {
        var start = string.IsNullOrWhiteSpace(from) ? DateTime.UtcNow.AddDays(-180).ToString("yyyy-MM-dd") : from;
        var end = string.IsNullOrWhiteSpace(to) ? DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd") : to;

        return Ok(await db.Executions.AsNoTracking()
            .Where(x => x.UserId == UserId &&
                string.Compare(x.Date, start) >= 0 &&
                string.Compare(x.Date, end) <= 0)
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.UpdatedAt)
            .Select(x => new
            {
                x.Id,
                x.UserId,
                x.ActivityId,
                x.Date,
                x.Status,
                x.UpdatedAt,
                ActivityTitle = x.Activity != null ? x.Activity.Title : null,
                ActivityCategory = x.Activity != null ? x.Activity.Category : null,
                ActivityTime = x.Activity != null ? x.Activity.Time : null
            })
            .ToListAsync());
    }

    [HttpPut("executions/{activityId:guid}/{date}")]
    public async Task<IActionResult> SetExecution(Guid activityId, string date, ExecutionRequest request)
    {
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) ||
            !ValidExecutionStatuses.Contains(request.Status))
            return BadRequest(new { message = "Execução inválida." });

        if (!await db.Activities.AnyAsync(x => x.Id == activityId && x.UserId == UserId && x.ArchivedAt == null))
            return NotFound();

        var item = await db.Executions.FirstOrDefaultAsync(
            x => x.UserId == UserId && x.ActivityId == activityId && x.Date == date);

        if (request.Status == "pending")
        {
            if (item is not null)
            {
                db.Executions.Remove(item);
                await db.SaveChangesAsync();
            }

            return Ok(new { status = "pending" });
        }

        if (item is null)
        {
            item = new Execution
            {
                Id = Guid.NewGuid(),
                UserId = UserId,
                ActivityId = activityId,
                Date = date,
                Status = request.Status,
                UpdatedAt = DateTime.UtcNow
            };
            db.Executions.Add(item);
        }
        else
        {
            item.Status = request.Status;
            item.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return Ok(item);
    }

    // O acompanhamento dos hábitos é isolado das estruturas legadas da ROUTINE 3.1.
    [HttpGet("habits/tracking")]
    public async Task<IActionResult> HabitTracking()
    {
        var from = DateTime.UtcNow.AddDays(-400).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var goals = await db.HabitGoals.AsNoTracking()
            .Where(x => x.UserId == UserId).ToListAsync();
        var entries = await db.HabitEntries.AsNoTracking()
            .Where(x => x.UserId == UserId && string.Compare(x.Date, from) >= 0)
            .ToListAsync();

        return Ok(new { goals, entries });
    }

    [HttpPut("habits/{activityId:guid}/goal")]
    public async Task<IActionResult> SetHabitGoal(Guid activityId, HabitGoalRequest request)
    {
        var activity = await db.Activities.AsNoTracking().FirstOrDefaultAsync(
            x => x.Id == activityId && x.UserId == UserId && x.ArchivedAt == null && x.Type == "habit");
        if (activity is null) return NotFound();

        var mode = (request.Mode ?? string.Empty).Trim().ToLowerInvariant();
        if (mode is not ("check" or "quantity" or "duration"))
            return BadRequest(new { message = "Forma de acompanhamento inválida." });
        if (request.CycleDays is not (21 or 30 or 60 or 90))
            return BadRequest(new { message = "Escolha um ciclo de 21, 30, 60 ou 90 dias." });
        if (request.Target <= 0 || request.Target > 100000)
            return BadRequest(new { message = "A meta precisa ser maior que zero e menor que 100.000." });

        var target = mode == "check" ? 1m : Math.Round(request.Target, 2);
        if (target <= 0) return BadRequest(new { message = "Meta inválida." });
        var unit = mode == "duration" ? "min" : mode == "check" ? "vez" : (request.Unit ?? "").Trim();
        if (string.IsNullOrWhiteSpace(unit) || unit.Length > 20)
            return BadRequest(new { message = "Informe uma unidade com até 20 caracteres." });

        var goal = await db.HabitGoals.FirstOrDefaultAsync(
            x => x.UserId == UserId && x.ActivityId == activityId);
        if (goal is null)
        {
            goal = new HabitGoal { ActivityId = activityId, UserId = UserId };
            db.HabitGoals.Add(goal);
        }
        goal.Mode = mode;
        goal.Target = target;
        goal.Unit = unit;
        goal.CycleDays = request.CycleDays;
        await db.SaveChangesAsync();
        return Ok(goal);
    }

    [HttpPut("habits/{activityId:guid}/progress/{date}")]
    public async Task<IActionResult> SetHabitProgress(Guid activityId, string date, HabitEntryRequest request)
    {
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var parsed))
            return BadRequest(new { message = "Data inválida." });

        if (request.Value < 0 || request.Value > 1000000)
            return BadRequest(new { message = "Quantidade inválida." });

        var activity = await db.Activities.AsNoTracking().FirstOrDefaultAsync(
            x => x.Id == activityId && x.UserId == UserId && x.ArchivedAt == null &&
                 x.Active && x.Type == "habit");
        if (activity is null) return NotFound();

        var goal = await db.HabitGoals.AsNoTracking().FirstOrDefaultAsync(
            x => x.ActivityId == activityId && x.UserId == UserId);
        if (goal is null || goal.Mode == "check")
            return BadRequest(new { message = "Este hábito não possui uma meta quantitativa." });

        if ((activity.StartDate is not null && string.Compare(date, activity.StartDate) < 0) ||
            (activity.EndDate is not null && string.Compare(date, activity.EndDate) > 0) ||
            !activity.Days.Split(',').Contains(((int)parsed.DayOfWeek).ToString(CultureInfo.InvariantCulture)))
            return BadRequest(new { message = "Este hábito não está programado para a data informada." });

        var value = Math.Round(request.Value, 2);
        var entry = await db.HabitEntries.FirstOrDefaultAsync(
            x => x.UserId == UserId && x.ActivityId == activityId && x.Date == date);
        if (entry is null)
        {
            entry = new HabitEntry
            {
                Id = Guid.NewGuid(), UserId = UserId, ActivityId = activityId, Date = date
            };
            db.HabitEntries.Add(entry);
        }
        entry.Value = value;
        entry.UpdatedAt = DateTime.UtcNow;

        // Mantém o status legado sincronizado, para Histórico/Hoje/Desempenho.
        var status = value >= goal.Target ? "done" : value > 0 ? "progress" : "pending";
        var execution = await db.Executions.FirstOrDefaultAsync(
            x => x.UserId == UserId && x.ActivityId == activityId && x.Date == date);
        if (status == "pending")
        {
            if (execution is not null) db.Executions.Remove(execution);
        }
        else if (execution is null)
        {
            db.Executions.Add(new Execution
            {
                Id = Guid.NewGuid(), UserId = UserId, ActivityId = activityId,
                Date = date, Status = status, UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            execution.Status = status;
            execution.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return Ok(new { entry, status });
    }

    [HttpGet("tasks")]
    public async Task<IActionResult> Tasks([FromQuery] Guid? activityId = null)
    {
        var query = db.RoutineTasks.AsNoTracking()
            .Where(x => x.UserId == UserId);

        if (activityId.HasValue)
            query = query.Where(x => x.ActivityId == activityId.Value);

        var items = await query
            .OrderBy(x => x.Status == "done")
            .ThenBy(x => x.DueDate)
            .ThenBy(x => x.DueTime)
            .ThenByDescending(x => x.CreatedAt)
            .Select(x => new
            {
                x.Id,
                x.UserId,
                x.ActivityId,
                x.Title,
                x.Project,
                x.DueDate,
                x.DueTime,
                x.Status,
                x.Priority,
                x.Notes,
                x.ClientRequestId,
                x.CompletedAt,
                x.CreatedAt,
                x.UpdatedAt,
                ActivityTitle = x.Activity != null ? x.Activity.Title : null,
                Checklist = x.Checklist
                    .OrderBy(c => c.SortOrder)
                    .ThenBy(c => c.CreatedAt)
                    .Select(c => new
                    {
                        c.Id,
                        c.TaskId,
                        c.Title,
                        c.Done,
                        c.SortOrder,
                        c.CreatedAt,
                        c.UpdatedAt
                    })
                    .ToList()
            })
            .ToListAsync();

        return Ok(items);
    }

    [HttpPost("tasks")]
    public async Task<IActionResult> CreateTask(RoutineTaskRequest request)
    {
        var normalized = NormalizeTaskRequest(request);
        if (normalized.Error is not null) return BadRequest(new { message = normalized.Error });

        if (normalized.ActivityId.HasValue &&
            !await db.Activities.AnyAsync(x => x.Id == normalized.ActivityId.Value && x.UserId == UserId && x.ArchivedAt == null))
            return BadRequest(new { message = "A rotina vinculada não existe." });

        if (!string.IsNullOrWhiteSpace(normalized.ClientRequestId))
        {
            var byRequest = await db.RoutineTasks.AsNoTracking()
                .Include(x => x.Checklist)
                .FirstOrDefaultAsync(x => x.UserId == UserId && x.ClientRequestId == normalized.ClientRequestId);
            if (byRequest is not null) return Ok(byRequest);
        }

        var titleLower = normalized.Title.ToLower();
        var duplicate = await db.RoutineTasks.AsNoTracking().AnyAsync(x =>
            x.UserId == UserId &&
            x.Status != "done" &&
            x.Title.ToLower() == titleLower &&
            x.ActivityId == normalized.ActivityId &&
            x.DueDate == normalized.DueDate &&
            x.DueTime == normalized.DueTime);

        if (duplicate)
            return Conflict(new { message = "Esta tarefa já existe para esta rotina e prazo." });

        var item = new RoutineTask
        {
            Id = Guid.NewGuid(),
            UserId = UserId,
            ActivityId = normalized.ActivityId,
            Title = normalized.Title,
            Project = normalized.Project,
            DueDate = normalized.DueDate,
            DueTime = normalized.DueTime,
            Status = normalized.Status,
            Priority = normalized.Priority,
            Notes = normalized.Notes,
            ClientRequestId = normalized.ClientRequestId,
            CompletedAt = normalized.Status == "done" ? DateTime.UtcNow : null,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        db.RoutineTasks.Add(item);

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (!string.IsNullOrWhiteSpace(normalized.ClientRequestId))
        {
            var existing = await db.RoutineTasks.AsNoTracking()
                .Include(x => x.Checklist)
                .FirstOrDefaultAsync(x => x.UserId == UserId && x.ClientRequestId == normalized.ClientRequestId);
            if (existing is not null) return Ok(existing);
            throw;
        }

        return Ok(item);
    }

    [HttpPut("tasks/{id:guid}")]
    public async Task<IActionResult> UpdateTask(Guid id, RoutineTaskRequest request)
    {
        var item = await db.RoutineTasks.Include(x => x.Checklist)
            .FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (item is null) return NotFound();

        var normalized = NormalizeTaskRequest(request);
        if (normalized.Error is not null) return BadRequest(new { message = normalized.Error });

        if (normalized.ActivityId.HasValue)
        {
            var targetActivity = await db.Activities.AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == normalized.ActivityId.Value && x.UserId == UserId);

            if (targetActivity is null)
                return BadRequest(new { message = "A rotina vinculada não existe." });

            var keepingExistingArchivedLink =
                item.ActivityId == normalized.ActivityId.Value &&
                targetActivity.ArchivedAt is not null;

            if (targetActivity.ArchivedAt is not null && !keepingExistingArchivedLink)
                return BadRequest(new { message = "Não é possível vincular uma tarefa a uma rotina arquivada." });
        }

        var titleLower = normalized.Title.ToLower();
        var duplicate = await db.RoutineTasks.AsNoTracking().AnyAsync(x =>
            x.UserId == UserId &&
            x.Id != id &&
            x.Status != "done" &&
            x.Title.ToLower() == titleLower &&
            x.ActivityId == normalized.ActivityId &&
            x.DueDate == normalized.DueDate &&
            x.DueTime == normalized.DueTime);

        if (duplicate)
            return Conflict(new { message = "Já existe outra tarefa com estes mesmos dados." });

        item.ActivityId = normalized.ActivityId;
        item.Title = normalized.Title;
        item.Project = normalized.Project;
        item.DueDate = normalized.DueDate;
        item.DueTime = normalized.DueTime;
        if (normalized.Status == "done" && item.Status != "done")
            item.CompletedAt = DateTime.UtcNow;
        else if (normalized.Status != "done")
            item.CompletedAt = null;

        item.Status = normalized.Status;
        item.Priority = normalized.Priority;
        item.Notes = normalized.Notes;
        item.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return Ok(item);
    }

    [HttpPut("tasks/{id:guid}/status")]
    public async Task<IActionResult> SetTaskStatus(Guid id, RoutineTaskStatusRequest request)
    {
        if (!ValidTaskStatuses.Contains(request.Status))
            return BadRequest(new { message = "Status de tarefa inválido." });

        var item = await db.RoutineTasks.Include(x => x.Checklist)
            .FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (item is null) return NotFound();

        if (request.Status == "done" && item.Status != "done")
            item.CompletedAt = DateTime.UtcNow;
        else if (request.Status != "done")
            item.CompletedAt = null;

        item.Status = request.Status;
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(item);
    }

    [HttpDelete("tasks/{id:guid}")]
    public async Task<IActionResult> DeleteTask(Guid id)
    {
        var item = await db.RoutineTasks.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (item is null) return NotFound();

        var checklist = await db.ChecklistItems
            .Where(x => x.TaskId == id)
            .ToListAsync();

        if (checklist.Count > 0)
            db.ChecklistItems.RemoveRange(checklist);

        db.RoutineTasks.Remove(item);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("tasks/{taskId:guid}/checklist")]
    public async Task<IActionResult> AddChecklistItem(Guid taskId, ChecklistItemRequest request)
    {
        if (!await db.RoutineTasks.AnyAsync(x => x.Id == taskId && x.UserId == UserId))
            return NotFound();

        var title = (request.Title ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(new { message = "Informe o item do checklist." });

        var item = new TaskChecklistItem
        {
            Id = Guid.NewGuid(),
            TaskId = taskId,
            Title = title.Length > 200 ? title[..200] : title,
            Done = request.Done,
            SortOrder = Math.Max(0, request.SortOrder),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        db.ChecklistItems.Add(item);
        await db.SaveChangesAsync();
        return Ok(item);
    }

    [HttpPut("tasks/{taskId:guid}/checklist/{itemId:guid}")]
    public async Task<IActionResult> UpdateChecklistItem(Guid taskId, Guid itemId, ChecklistItemRequest request)
    {
        if (!await db.RoutineTasks.AnyAsync(x => x.Id == taskId && x.UserId == UserId))
            return NotFound();

        var item = await db.ChecklistItems.FirstOrDefaultAsync(x => x.Id == itemId && x.TaskId == taskId);
        if (item is null) return NotFound();

        var title = (request.Title ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(new { message = "Informe o item do checklist." });

        item.Title = title.Length > 200 ? title[..200] : title;
        item.Done = request.Done;
        item.SortOrder = Math.Max(0, request.SortOrder);
        item.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return Ok(item);
    }

    [HttpDelete("tasks/{taskId:guid}/checklist/{itemId:guid}")]
    public async Task<IActionResult> DeleteChecklistItem(Guid taskId, Guid itemId)
    {
        if (!await db.RoutineTasks.AnyAsync(x => x.Id == taskId && x.UserId == UserId))
            return NotFound();

        var item = await db.ChecklistItems.FirstOrDefaultAsync(x => x.Id == itemId && x.TaskId == taskId);
        if (item is null) return NotFound();

        db.ChecklistItems.Remove(item);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<bool> HasDuplicateActivity(Activity input, Guid? ignoreId = null)
    {
        var title = input.Title.ToLower();
        return await db.Activities.AsNoTracking().AnyAsync(x =>
            x.UserId == UserId &&
            x.ArchivedAt == null &&
            (!ignoreId.HasValue || x.Id != ignoreId.Value) &&
            x.Title.ToLower() == title &&
            x.Time == input.Time &&
            x.DurationMinutes == input.DurationMinutes &&
            x.Days == input.Days &&
            x.StartDate == input.StartDate &&
            x.EndDate == input.EndDate);
    }

    private static void NormalizeActivity(Activity item)
    {
        item.Title = (item.Title ?? string.Empty).Trim();
        if (item.Title.Length > 100) item.Title = item.Title[..100];

        item.Category = string.IsNullOrWhiteSpace(item.Category) ? "Pessoal" : item.Category.Trim();
        if (item.Category.Length > 60) item.Category = item.Category[..60];

        item.Time = NormalizeTime(item.Time, "09:00");
        item.DurationMinutes = Math.Clamp(item.DurationMinutes, 5, 1435);
        item.Weight = 1;
        item.Priority = ValidPriorities.Contains(item.Priority) ? item.Priority : "medium";
        item.Type = new[] { "routine", "habit" }.Contains(item.Type) ? item.Type : "routine";
        item.Days = NormalizeDays(item.Days);
        item.StartDate = NormalizeDate(item.StartDate);
        item.EndDate = NormalizeDate(item.EndDate);
        item.Notes = string.IsNullOrWhiteSpace(item.Notes) ? null : item.Notes.Trim();
        if (item.Notes?.Length > 500) item.Notes = item.Notes[..500];

        item.ClientRequestId = string.IsNullOrWhiteSpace(item.ClientRequestId) ? null : item.ClientRequestId.Trim();
        if (item.ClientRequestId?.Length > 64) item.ClientRequestId = item.ClientRequestId[..64];
    }

    private static (
        string Title,
        Guid? ActivityId,
        string? Project,
        string? DueDate,
        string? DueTime,
        string Status,
        string Priority,
        string? Notes,
        string? ClientRequestId,
        string? Error) NormalizeTaskRequest(RoutineTaskRequest request)
    {
        var title = (request.Title ?? string.Empty).Trim();
        if (title.Length > 160) title = title[..160];
        if (string.IsNullOrWhiteSpace(title))
            return (title, request.ActivityId, null, null, null, "pending", "medium", null, null, "Informe o título da tarefa.");

        var project = string.IsNullOrWhiteSpace(request.Project) ? null : request.Project.Trim();
        if (project?.Length > 100) project = project[..100];

        var dueDate = NormalizeDate(request.DueDate);
        if (!string.IsNullOrWhiteSpace(request.DueDate) && dueDate is null)
            return (title, request.ActivityId, project, null, null, "pending", "medium", null, null, "Data da tarefa inválida.");

        var dueTime = string.IsNullOrWhiteSpace(request.DueTime) ? null : NormalizeTime(request.DueTime, "");
        if (!string.IsNullOrWhiteSpace(request.DueTime) && string.IsNullOrWhiteSpace(dueTime))
            return (title, request.ActivityId, project, dueDate, null, "pending", "medium", null, null, "Horário da tarefa inválido.");

        var status = ValidTaskStatuses.Contains(request.Status ?? "") ? request.Status! : "pending";
        var priority = ValidPriorities.Contains(request.Priority ?? "") ? request.Priority! : "medium";

        var notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        if (notes?.Length > 1000) notes = notes[..1000];

        var requestId = string.IsNullOrWhiteSpace(request.ClientRequestId) ? null : request.ClientRequestId.Trim();
        if (requestId?.Length > 64) requestId = requestId[..64];

        return (title, request.ActivityId, project, dueDate, dueTime, status, priority, notes, requestId, null);
    }

    private static string NormalizeDays(string? value)
    {
        var days = (value ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => int.TryParse(x, out var n) ? n : -1)
            .Where(x => x is >= 0 and <= 6)
            .Distinct()
            .OrderBy(x => x)
            .ToArray();

        return days.Length == 0 ? "1,2,3,4,5" : string.Join(',', days);
    }

    private static string? NormalizeDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTime.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.ToString("yyyy-MM-dd")
            : null;
    }

    private static string NormalizeTime(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        return TimeSpan.TryParseExact(value.Trim(), @"hh\:mm", CultureInfo.InvariantCulture, out var parsed) &&
               parsed >= TimeSpan.Zero &&
               parsed < TimeSpan.FromDays(1)
            ? parsed.ToString(@"hh\:mm")
            : fallback;
    }
}