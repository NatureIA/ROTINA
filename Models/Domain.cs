using System.ComponentModel.DataAnnotations;

namespace Routine.Models;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(80)] public string Login { get; set; } = string.Empty;
    [MaxLength(500)] public string PasswordHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<Activity> Activities { get; set; } = new List<Activity>();
    public ICollection<Execution> Executions { get; set; } = new List<Execution>();
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
    public int Weight { get; set; } = 3;
    [MaxLength(20)] public string Priority { get; set; } = "medium";
    [MaxLength(20)] public string Type { get; set; } = "routine";
    [MaxLength(30)] public string Days { get; set; } = "1,2,3,4,5";
    [MaxLength(10)] public string? StartDate { get; set; }
    [MaxLength(10)] public string? EndDate { get; set; }
    [MaxLength(500)] public string? Notes { get; set; }
    public bool Active { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<Execution> Executions { get; set; } = new List<Execution>();
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

public record LoginRequest(string Login, string Password);
public record LoginResponse(string Token, string Login);
public record ExecutionRequest(string Status);