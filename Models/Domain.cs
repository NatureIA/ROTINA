using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Routine.Models;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(80)] public string Login { get; set; } = string.Empty;
    [MaxLength(254)] public string? Email { get; set; }
    [MaxLength(254)] public string? NormalizedEmail { get; set; }
    [MaxLength(500)] public string PasswordHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<Activity> Activities { get; set; } = new List<Activity>();
    public ICollection<Execution> Executions { get; set; } = new List<Execution>();
    public ICollection<RoutineTask> Tasks { get; set; } = new List<RoutineTask>();
}

public class Activity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    [MaxLength(100)] public string Title { get; set; } = string.Empty;
    [MaxLength(60)] public string Category { get; set; } = "Pessoal";
    [MaxLength(5)] public string Time { get; set; } = "09:00";
    public int DurationMinutes { get; set; } = 30;
    public int Weight { get; set; } = 1;
    [MaxLength(20)] public string Priority { get; set; } = "medium";
    [MaxLength(20)] public string Type { get; set; } = "routine";
    [MaxLength(30)] public string Days { get; set; } = "1,2,3,4,5";
    [MaxLength(10)] public string? StartDate { get; set; }
    [MaxLength(10)] public string? EndDate { get; set; }
    [MaxLength(500)] public string? Notes { get; set; }
    [MaxLength(64)] public string? ClientRequestId { get; set; }
    public bool Active { get; set; } = true;
    public bool? ArchivedWasActive { get; set; }
    public DateTime? ArchivedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<Execution> Executions { get; set; } = new List<Execution>();
    [JsonIgnore] public ICollection<RoutineTask> Tasks { get; set; } = new List<RoutineTask>();
}

public class Execution
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public Guid ActivityId { get; set; }
    public Activity? Activity { get; set; }
    [MaxLength(10)] public string Date { get; set; } = string.Empty;
    [MaxLength(20)] public string Status { get; set; } = "pending";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class RoutineTask
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    [JsonIgnore] public User? User { get; set; }
    public Guid? ActivityId { get; set; }
    [JsonIgnore] public Activity? Activity { get; set; }
    [MaxLength(160)] public string Title { get; set; } = string.Empty;
    [MaxLength(100)] public string? Project { get; set; }
    [MaxLength(10)] public string? DueDate { get; set; }
    [MaxLength(5)] public string? DueTime { get; set; }
    [MaxLength(20)] public string Status { get; set; } = "pending";
    [MaxLength(20)] public string Priority { get; set; } = "medium";
    [MaxLength(1000)] public string? Notes { get; set; }
    [MaxLength(64)] public string? ClientRequestId { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<TaskChecklistItem> Checklist { get; set; } = new List<TaskChecklistItem>();
}

public class TaskChecklistItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TaskId { get; set; }
    [JsonIgnore] public RoutineTask? Task { get; set; }
    [MaxLength(200)] public string Title { get; set; } = string.Empty;
    public bool Done { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public record LoginRequest(string? Email, string? Password, string? Login = null);
public record LoginResponse(string Token, string Email);
public record ExecutionRequest(string Status);
public record RoutineTaskRequest(
    string? Title,
    Guid? ActivityId,
    string? Project,
    string? DueDate,
    string? DueTime,
    string? Status,
    string? Priority,
    string? Notes,
    string? ClientRequestId);
public record RoutineTaskStatusRequest(string Status);
public record ChecklistItemRequest(string? Title, bool Done, int SortOrder);