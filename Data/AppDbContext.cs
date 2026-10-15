using Microsoft.EntityFrameworkCore;
using Routine.Models;

namespace Routine.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<Execution> Executions => Set<Execution>();
    public DbSet<RoutineTask> RoutineTasks => Set<RoutineTask>();
    public DbSet<TaskChecklistItem> ChecklistItems => Set<TaskChecklistItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>().HasIndex(x => x.Login).IsUnique();
        modelBuilder.Entity<User>()
            .HasIndex(x => x.NormalizedEmail)
            .IsUnique()
            .HasDatabaseName("IX_Users_NormalizedEmail")
            .HasFilter("[NormalizedEmail] IS NOT NULL");

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
    }
}