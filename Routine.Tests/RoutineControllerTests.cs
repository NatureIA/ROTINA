using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Routine.Controllers;
using Routine.Data;
using Routine.Models;
using Xunit;

namespace Routine.Tests;

public class RoutineControllerTests
{
    [Fact]
    public async Task Activities_ReturnOnlyCurrentUserAndNotArchived()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();

        db.Activities.AddRange(
            MakeActivity(userId, "Visível"),
            MakeActivity(otherUserId, "Outro usuário"),
            MakeActivity(userId, "Arquivada", archivedAt: DateTime.UtcNow)
        );
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var result = await controller.Activities();

        var ok = Assert.IsType<OkObjectResult>(result);
        var items = Assert.IsAssignableFrom<IEnumerable<Activity>>(ok.Value).ToList();

        Assert.Single(items);
        Assert.Equal("Visível", items[0].Title);
    }

    [Fact]
    public async Task Activities_CanIncludeArchivedForHistoricalCalculations()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        db.Activities.AddRange(
            MakeActivity(userId, "Atual"),
            MakeActivity(userId, "Antiga", DateTime.UtcNow.AddDays(-1))
        );
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var result = await controller.Activities(includeArchived: true);

        var ok = Assert.IsType<OkObjectResult>(result);
        var items = Assert.IsAssignableFrom<IEnumerable<Activity>>(ok.Value).ToList();

        Assert.Equal(2, items.Count);
        Assert.Contains(items, x => x.Title == "Antiga" && x.ArchivedAt is not null);
    }

    [Fact]
    public async Task DeleteActivity_ArchivesInsteadOfDeletingExecutionHistory()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var activity = MakeActivity(userId, "Trabalho");
        var execution = new Execution
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            ActivityId = activity.Id,
            Date = "2026-10-14",
            Status = "done"
        };

        db.Activities.Add(activity);
        db.Executions.Add(execution);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var result = await controller.DeleteActivity(activity.Id);

        Assert.IsType<NoContentResult>(result);

        var storedActivity = await db.Activities.SingleAsync(x => x.Id == activity.Id);
        Assert.False(storedActivity.Active);
        Assert.NotNull(storedActivity.ArchivedAt);
        Assert.True(await db.Executions.AnyAsync(x => x.Id == execution.Id));
    }

    [Fact]
    public async Task CreateActivity_RejectsEquivalentPausedActivity()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var existing = MakeActivity(userId, "Academia");
        existing.Active = false;
        db.Activities.Add(existing);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var duplicate = MakeActivity(Guid.Empty, "Academia");
        duplicate.ClientRequestId = Guid.NewGuid().ToString();

        var result = await controller.CreateActivity(duplicate);

        Assert.IsType<ConflictObjectResult>(result);
        Assert.Single(await db.Activities.ToListAsync());
    }

    [Fact]
    public async Task SetTaskStatus_DoneSetsCompletedAt_AndReopenClearsIt()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var task = new RoutineTask
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = "Enviar proposta",
            Status = "pending",
            Priority = "medium"
        };
        db.RoutineTasks.Add(task);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var doneResult = await controller.SetTaskStatus(task.Id, new RoutineTaskStatusRequest("done"));
        Assert.IsType<OkObjectResult>(doneResult);
        Assert.Equal("done", task.Status);
        Assert.NotNull(task.CompletedAt);

        var pendingResult = await controller.SetTaskStatus(task.Id, new RoutineTaskStatusRequest("pending"));
        Assert.IsType<OkObjectResult>(pendingResult);
        Assert.Equal("pending", task.Status);
        Assert.Null(task.CompletedAt);
    }


    [Fact]
    public async Task CreateActivity_SameClientRequestId_IsIdempotent()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var requestId = Guid.NewGuid().ToString();
        var controller = CreateController(db, userId);

        var first = MakeActivity(Guid.Empty, "Leitura");
        first.ClientRequestId = requestId;
        var second = MakeActivity(Guid.Empty, "Leitura");
        second.ClientRequestId = requestId;

        var firstResult = await controller.CreateActivity(first);
        var secondResult = await controller.CreateActivity(second);

        Assert.IsType<OkObjectResult>(firstResult);
        Assert.IsType<OkObjectResult>(secondResult);
        Assert.Single(await db.Activities.Where(x => x.UserId == userId).ToListAsync());
    }

    [Fact]
    public async Task CreateTask_RejectsDuplicateOpenTaskForSameRoutineAndDeadline()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var activity = MakeActivity(userId, "Trabalho");
        db.Activities.Add(activity);
        db.RoutineTasks.Add(new RoutineTask
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            ActivityId = activity.Id,
            Title = "Enviar proposta",
            DueDate = "2026-10-14",
            DueTime = "14:00",
            Status = "pending",
            Priority = "medium"
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var request = new RoutineTaskRequest(
            "Enviar proposta",
            activity.Id,
            null,
            "2026-10-14",
            "14:00",
            "pending",
            "medium",
            null,
            Guid.NewGuid().ToString());

        var result = await controller.CreateTask(request);

        Assert.IsType<ConflictObjectResult>(result);
        Assert.Single(await db.RoutineTasks.ToListAsync());
    }

    [Fact]
    public async Task CreateTask_CannotLinkToArchivedActivity()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var archived = MakeActivity(userId, "Projeto antigo", DateTime.UtcNow);
        db.Activities.Add(archived);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var request = new RoutineTaskRequest(
            "Tarefa órfã",
            archived.Id,
            null,
            "2026-10-14",
            "10:00",
            "pending",
            "medium",
            null,
            Guid.NewGuid().ToString());

        var result = await controller.CreateTask(request);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(await db.RoutineTasks.ToListAsync());
    }

    [Fact]
    public async Task UpdateTask_AllowsKeepingArchivedActivityLink()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var archived = MakeActivity(userId, "Projeto antigo", DateTime.UtcNow.AddDays(-1));
        var task = new RoutineTask
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            ActivityId = archived.Id,
            Title = "Revisar documento",
            DueDate = "2026-10-14",
            DueTime = "15:00",
            Status = "pending",
            Priority = "medium"
        };

        db.Activities.Add(archived);
        db.RoutineTasks.Add(task);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var request = new RoutineTaskRequest(
            "Revisar documento atualizado",
            archived.Id,
            "Projeto histórico",
            "2026-10-14",
            "15:00",
            "pending",
            "high",
            "Observação atualizada",
            null);

        var result = await controller.UpdateTask(task.Id, request);

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(archived.Id, task.ActivityId);
        Assert.Equal("Revisar documento atualizado", task.Title);
        Assert.Equal("high", task.Priority);
    }

    [Fact]
    public async Task SetExecution_ArchivedActivityIsRejected()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var archived = MakeActivity(userId, "Arquivada", DateTime.UtcNow);
        db.Activities.Add(archived);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var result = await controller.SetExecution(
            archived.Id,
            "2026-10-14",
            new ExecutionRequest("done"));

        Assert.IsType<NotFoundResult>(result);
        Assert.Empty(await db.Executions.ToListAsync());
    }

    [Fact]
    public async Task DeleteTask_RemovesChecklistItemsExplicitly()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var task = new RoutineTask
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = "Tarefa com checklist",
            Status = "pending",
            Priority = "medium"
        };
        db.RoutineTasks.Add(task);
        db.ChecklistItems.Add(new TaskChecklistItem
        {
            Id = Guid.NewGuid(),
            TaskId = task.Id,
            Title = "Item",
            Done = false,
            SortOrder = 0
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var result = await controller.DeleteTask(task.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.Empty(await db.RoutineTasks.ToListAsync());
        Assert.Empty(await db.ChecklistItems.ToListAsync());
    }

    [Fact]
    public async Task HabitTracking_StoresDailyQuantityAndSynchronizesLegacyStatus()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var habit = MakeActivity(userId, "Beber água");
        habit.Type = "habit";
        habit.Days = "0,1,2,3,4,5,6";
        habit.StartDate = "2026-10-01";
        db.Activities.Add(habit);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var goalResult = await controller.SetHabitGoal(
            habit.Id, new HabitGoalRequest("quantity", 4, "L", 21));
        Assert.IsType<OkObjectResult>(goalResult);

        var first = await controller.SetHabitProgress(
            habit.Id, "2026-10-16", new HabitEntryRequest(2.5m));
        Assert.IsType<OkObjectResult>(first);
        Assert.Equal("progress", (await db.Executions.SingleAsync()).Status);
        Assert.Equal(2.5m, (await db.HabitEntries.SingleAsync()).Value);

        var completed = await controller.SetHabitProgress(
            habit.Id, "2026-10-16", new HabitEntryRequest(4m));
        Assert.IsType<OkObjectResult>(completed);
        Assert.Equal("done", (await db.Executions.SingleAsync()).Status);
        Assert.Single(await db.HabitEntries.ToListAsync());

        await controller.SetHabitProgress(
            habit.Id, "2026-10-16", new HabitEntryRequest(3m));
        Assert.Equal("progress", (await db.Executions.SingleAsync()).Status);
        Assert.Equal(3m, (await db.HabitEntries.SingleAsync()).Value);
    }

    [Fact]
    public async Task HabitTracking_EnforcesUserIsolationAndScheduledDays()
    {
        await using var db = CreateDb();
        var owner = Guid.NewGuid();
        var outsider = Guid.NewGuid();
        var habit = MakeActivity(owner, "Leitura");
        habit.Type = "habit";
        habit.StartDate = "2026-10-16";
        habit.Days = "1,2,3,4,5";
        db.Activities.Add(habit);
        await db.SaveChangesAsync();

        var otherController = CreateController(db, outsider);
        Assert.IsType<NotFoundResult>(await otherController.SetHabitGoal(
            habit.Id, new HabitGoalRequest("duration", 30, "min", 21)));

        var controller = CreateController(db, owner);
        Assert.IsType<OkObjectResult>(await controller.SetHabitGoal(
            habit.Id, new HabitGoalRequest("duration", 30, "min", 21)));
        Assert.IsType<BadRequestObjectResult>(await controller.SetHabitProgress(
            habit.Id, "2026-10-17", new HabitEntryRequest(30m)));
        Assert.IsType<BadRequestObjectResult>(await controller.SetHabitProgress(
            habit.Id, "2026-10-15", new HabitEntryRequest(30m)));
        Assert.IsType<NotFoundResult>(await otherController.SetHabitProgress(
            habit.Id, "2026-10-16", new HabitEntryRequest(30m)));
        Assert.Empty(await db.HabitEntries.ToListAsync());
    }

    [Fact]
    public async Task HabitTracking_ArchivesWithoutErasingGoalOrDailyHistory()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        var habit = MakeActivity(userId, "Meditação");
        habit.Type = "habit";
        habit.Days = "0,1,2,3,4,5,6";
        db.Activities.Add(habit);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        await controller.SetHabitGoal(habit.Id, new HabitGoalRequest("duration", 15m, "min", 30));
        await controller.SetHabitProgress(habit.Id, "2026-10-16", new HabitEntryRequest(15m));
        Assert.IsType<NoContentResult>(await controller.DeleteActivity(habit.Id));

        Assert.True(await db.HabitGoals.AnyAsync(x => x.ActivityId == habit.Id));
        Assert.True(await db.HabitEntries.AnyAsync(x => x.ActivityId == habit.Id));
        Assert.True(await db.Executions.AnyAsync(x => x.ActivityId == habit.Id));
        Assert.IsType<NotFoundResult>(await controller.SetHabitProgress(
            habit.Id, "2026-10-17", new HabitEntryRequest(15m)));
    }

    private static AppDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static RoutineController CreateController(AppDbContext db, Guid userId)
    {
        var controller = new RoutineController(db);
        var identity = new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) },
            "test");

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(identity)
            }
        };

        return controller;
    }

    private static Activity MakeActivity(Guid userId, string title, DateTime? archivedAt = null)
    {
        return new Activity
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = title,
            Category = "Pessoal",
            Time = "09:00",
            DurationMinutes = 30,
            Days = "1,2,3,4,5",
            StartDate = null,
            EndDate = null,
            Priority = "medium",
            Type = "routine",
            Active = archivedAt is null,
            ArchivedWasActive = archivedAt is null ? null : true,
            ArchivedAt = archivedAt,
            ClientRequestId = Guid.NewGuid().ToString()
        };
    }
}
