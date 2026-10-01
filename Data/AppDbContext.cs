using Microsoft.EntityFrameworkCore;
using Routine.Models;

namespace Routine.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<Execution> Executions => Set<Execution>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>().HasIndex(x => x.Login).IsUnique();
        modelBuilder.Entity<Activity>().HasOne(x => x.User).WithMany(x => x.Activities).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Execution>().HasOne(x => x.User).WithMany(x => x.Executions).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<Execution>().HasOne(x => x.Activity).WithMany(x => x.Executions).HasForeignKey(x => x.ActivityId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Execution>().HasIndex(x => new { x.UserId, x.ActivityId, x.Date }).IsUnique();
    }
}