using Microsoft.EntityFrameworkCore;
using Routine.Models;

namespace Routine.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<KiwifyEntitlement> KiwifyEntitlements => Set<KiwifyEntitlement>();
    public DbSet<KiwifyWebhookReceipt> KiwifyWebhookReceipts => Set<KiwifyWebhookReceipt>();
    public DbSet<KiwifyWebhookDiagnostic> KiwifyWebhookDiagnostics => Set<KiwifyWebhookDiagnostic>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<Execution> Executions => Set<Execution>();
    public DbSet<RoutineTask> RoutineTasks => Set<RoutineTask>();
    public DbSet<TaskChecklistItem> ChecklistItems => Set<TaskChecklistItem>();
    public DbSet<HabitGoal> HabitGoals => Set<HabitGoal>();
    public DbSet<HabitEntry> HabitEntries => Set<HabitEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>().HasIndex(x => x.Login).IsUnique();
        modelBuilder.Entity<User>()
            .HasIndex(x => x.NormalizedEmail)
            .IsUnique()
            .HasDatabaseName("IX_Users_NormalizedEmail")
            .HasFilter("[NormalizedEmail] IS NOT NULL");

        modelBuilder.Entity<KiwifyEntitlement>()
            .HasIndex(x => new { x.ProductId, x.SubscriptionId })
            .IsUnique().HasFilter("[SubscriptionId] IS NOT NULL");
        modelBuilder.Entity<KiwifyEntitlement>()
            .HasIndex(x => new { x.ProductId, x.OrderId })
            .IsUnique();
        modelBuilder.Entity<KiwifyEntitlement>()
            .HasIndex(x => new { x.UserId, x.PaidThroughUtc });
        modelBuilder.Entity<KiwifyEntitlement>()
            .HasOne(x => x.User).WithMany()
            .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<KiwifyWebhookReceipt>()
            .HasIndex(x => x.EventKey).IsUnique();
        modelBuilder.Entity<KiwifyWebhookDiagnostic>()
            .HasIndex(x => x.ReceivedAtUtc);

        modelBuilder.Entity<PasswordResetToken>()
            .HasIndex(x => x.TokenHash).IsUnique();
        modelBuilder.Entity<PasswordResetToken>()
            .HasIndex(x => new { x.UserId, x.CreatedAt });
        modelBuilder.Entity<PasswordResetToken>()
            .HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Activity>()
            .HasOne(x => x.User)
            .WithMany(x => x.Activities)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Activity>()
            .HasIndex(x => new { x.UserId, x.ClientRequestId })
            .IsUnique()
            .HasDatabaseName("IX_Activities_UserId_ClientRequestId")
            .HasFilter("[ClientRequestId] IS NOT NULL");

        modelBuilder.Entity<Execution>()
            .HasOne(x => x.User)
            .WithMany(x => x.Executions)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        modelBuilder.Entity<Execution>()
            .HasOne(x => x.Activity)
            .WithMany(x => x.Executions)
            .HasForeignKey(x => x.ActivityId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Execution>()
            .HasIndex(x => new { x.UserId, x.ActivityId, x.Date })
            .IsUnique();

        modelBuilder.Entity<RoutineTask>()
            .HasOne(x => x.User)
            .WithMany(x => x.Tasks)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        modelBuilder.Entity<RoutineTask>()
            .HasOne(x => x.Activity)
            .WithMany(x => x.Tasks)
            .HasForeignKey(x => x.ActivityId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<RoutineTask>().HasIndex(x => new { x.UserId, x.DueDate });
        modelBuilder.Entity<RoutineTask>()
            .HasIndex(x => new { x.UserId, x.ClientRequestId })
            .IsUnique()
            .HasFilter("[ClientRequestId] IS NOT NULL");

        modelBuilder.Entity<TaskChecklistItem>()
            .HasOne(x => x.Task)
            .WithMany(x => x.Checklist)
            .HasForeignKey(x => x.TaskId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<TaskChecklistItem>()
            .HasIndex(x => new { x.TaskId, x.SortOrder });

        modelBuilder.Entity<HabitGoal>().HasKey(x => x.ActivityId);
        modelBuilder.Entity<HabitGoal>().Property(x => x.Target).HasPrecision(12, 2);
        modelBuilder.Entity<HabitGoal>().HasIndex(x => x.UserId);

        modelBuilder.Entity<HabitEntry>().Property(x => x.Value).HasPrecision(12, 2);
        modelBuilder.Entity<HabitEntry>()
            .HasIndex(x => new { x.UserId, x.ActivityId, x.Date })
            .IsUnique();
    }
}