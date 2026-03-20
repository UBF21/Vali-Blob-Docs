---
title: Almacén EF Core
sidebar_label: EF Core
---

# Almacén de Sesiones con EF Core

`ValiBlob.EFCore` proporciona un almacén de sesiones reanudables usando Entity Framework Core. Compatible con PostgreSQL, MySQL/MariaDB, SQL Server y SQLite. Ideal si tu infraestructura no incluye Redis o si necesitas consultar y auditar las sesiones de subida con SQL.

## Instalación

```bash
dotnet add package ValiBlob.EFCore
```

Más el paquete del proveedor de base de datos:

```bash
# PostgreSQL
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL

# MySQL / MariaDB
dotnet add package Pomelo.EntityFrameworkCore.MySql

# SQL Server
dotnet add package Microsoft.EntityFrameworkCore.SqlServer

# SQLite (desarrollo y pruebas)
dotnet add package Microsoft.EntityFrameworkCore.Sqlite
```

## Configuración con DbContext existente

Si tu aplicación ya tiene un `DbContext`, agrega el modelo de sesiones a él:

```csharp
// AppDbContext.cs
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<ResumableUploadSessionEntity> SesionesSubida =>
        Set<ResumableUploadSessionEntity>();

    // ... tus otras entidades

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ConfigureValiBlob(); // Extensión de ValiBlob.EFCore
        base.OnModelCreating(modelBuilder);
    }
}
```

```csharp
// Program.cs
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts => { /* ... */ })
    .UseEFCoreResumableStore<AppDbContext>();
```

## Configuración con DbContext dedicado

Para mantener las sesiones de ValiBlob separadas de la base de datos principal:

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts => { /* ... */ })
    .UseEFCoreResumableStore(efcore =>
    {
        efcore.UseNpgsql(builder.Configuration.GetConnectionString("ValiBlob")!);
    });
```

## EFCoreResumableStoreOptions

```csharp
public class EFCoreResumableStoreOptions
{
    /// <summary>Tiempo de vida predeterminado de las sesiones. Por defecto: 24 horas.</summary>
    public TimeSpan DefaultSessionTtl { get; set; } = TimeSpan.FromHours(24);

    /// <summary>Nombre del esquema SQL de la tabla. null = esquema predeterminado.</summary>
    public string? Schema { get; set; }

    /// <summary>Nombre de la tabla de sesiones. Por defecto: "ResumableUploadSessions".</summary>
    public string TableName { get; set; } = "ResumableUploadSessions";
}
```

```csharp
.UseEFCoreResumableStore<AppDbContext>(efcore =>
{
    efcore.DefaultSessionTtl = TimeSpan.FromDays(7);
    efcore.Schema = "storage";
    efcore.TableName = "sesiones_subida";
})
```

## Cadenas de conexión por proveedor

```json
{
  "ConnectionStrings": {
    "Default": "Host=localhost;Database=miapp;Username=usuario;Password=contraseña",
    "ValiBlob": "Host=localhost;Database=valiblob_sessions;Username=usuario;Password=contraseña"
  }
}
```

```csharp
// PostgreSQL
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// MySQL / MariaDB
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseMySql(
        builder.Configuration.GetConnectionString("Default"),
        ServerVersion.AutoDetect(builder.Configuration.GetConnectionString("Default"))));

// SQL Server
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

// SQLite (desarrollo)
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseSqlite("Data Source=sesiones-valiblob.db"));
```

## Migraciones

```bash
# Crear la migración
dotnet ef migrations add AgregarValiBlob --context AppDbContext

# Aplicar la migración
dotnet ef database update --context AppDbContext
```

### Aplicar migraciones automáticamente al iniciar

```csharp
var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}

await app.RunAsync();
```

## Esquema de la tabla generada

```sql
CREATE TABLE "ResumableUploadSessions" (
    "Id"              TEXT NOT NULL PRIMARY KEY,            -- SessionId (GUID)
    "Path"            TEXT NOT NULL,                        -- Ruta de destino
    "TotalSizeBytes"  BIGINT NOT NULL,                     -- Tamaño total del archivo
    "UploadedBytes"   BIGINT NOT NULL DEFAULT 0,           -- Bytes recibidos hasta ahora
    "ChunksUploaded"  INT NOT NULL DEFAULT 0,              -- Número de chunks recibidos
    "Status"          INT NOT NULL DEFAULT 0,              -- 0=Active, 1=Completed, 2=Aborted
    "ContentType"     TEXT,                                -- Tipo MIME del archivo
    "MetadataJson"    TEXT,                                -- Metadatos en JSON
    "CreatedAt"       TIMESTAMP WITH TIME ZONE NOT NULL,
    "ExpiresAt"       TIMESTAMP WITH TIME ZONE NOT NULL,
    "CompletedAt"     TIMESTAMP WITH TIME ZONE
);

-- Índice para la limpieza de sesiones expiradas
CREATE INDEX "IX_ResumableUploadSessions_Status_ExpiresAt"
    ON "ResumableUploadSessions" ("Status", "ExpiresAt");
```

## Consultas de diagnóstico y auditoría

Una ventaja de EF Core es poder consultar las sesiones directamente con LINQ:

```csharp
// Sesiones activas actualmente
var activas = await db.SesionesSubida
    .Where(s => s.Status == ResumableUploadStatus.Active
             && s.ExpiresAt > DateTimeOffset.UtcNow)
    .OrderByDescending(s => s.CreatedAt)
    .ToListAsync();

// Total de bytes en proceso de subida (sesiones activas)
var bytesEnCurso = await db.SesionesSubida
    .Where(s => s.Status == ResumableUploadStatus.Active)
    .SumAsync(s => s.TotalSizeBytes);

// Tasa de éxito de las últimas 24 horas
var hace24h = DateTimeOffset.UtcNow.AddHours(-24);
var completadas = await db.SesionesSubida
    .Where(s => s.CreatedAt >= hace24h && s.Status == ResumableUploadStatus.Completed)
    .CountAsync();
var total = await db.SesionesSubida
    .Where(s => s.CreatedAt >= hace24h)
    .CountAsync();

Console.WriteLine($"Tasa de éxito: {(total > 0 ? completadas * 100.0 / total : 0):F1}%");
```

## Limpieza de sesiones expiradas

A diferencia de Redis, EF Core no tiene TTL automático. Debes implementar un job de limpieza:

```csharp
public class LimpiezaSesionesExpiradas(
    IServiceScopeFactory scopeFactory,
    ILogger<LimpiezaSesionesExpiradas> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(6));

        while (await timer.WaitForNextTickAsync(ct))
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = scope.ServiceProvider.GetRequiredService<IResumableStorageProvider>();

            // 1. Abortar sesiones expiradas y limpiar sus chunks
            var expiradas = await db.SesionesSubida
                .Where(s => s.Status == ResumableUploadStatus.Active
                         && s.ExpiresAt < DateTimeOffset.UtcNow)
                .ToListAsync(ct);

            foreach (var sesion in expiradas)
            {
                await storage.AbortResumableUploadAsync(sesion.Id, ct);
                logger.LogInformation("Sesión expirada abortada: {SessionId}", sesion.Id);
            }

            // 2. Eliminar registros históricos con más de 30 días
            var limiteHistorial = DateTimeOffset.UtcNow.AddDays(-30);
            var eliminados = await db.SesionesSubida
                .Where(s => s.Status != ResumableUploadStatus.Active
                         && s.CreatedAt < limiteHistorial)
                .ExecuteDeleteAsync(ct);

            if (eliminados > 0)
                logger.LogInformation("Eliminados {Count} registros históricos de sesiones", eliminados);
        }
    }
}

builder.Services.AddHostedService<LimpiezaSesionesExpiradas>();
```

:::tip Consejo
Si tu aplicación ya usa Hangfire o Quartz.NET para tareas programadas, integra la limpieza de sesiones en ese sistema. Tendrás mayor control sobre reintentos, monitoreo y alertas ante fallos en la tarea de limpieza.
:::

:::info Información
Para bases de datos con alta carga, agrega índices adicionales sobre `CreatedAt` si consultas sesiones por fecha frecuentemente, y sobre `Path` si buscas sesiones por ruta de archivo. La tabla suele ser pequeña (sesiones activas son efímeras), pero el historial puede crecer si no se limpia periódicamente.
:::
