---
title: Almacén Redis
sidebar_label: Redis
---

# Almacén de Sesiones con Redis

`ValiBlob.Redis` proporciona un almacén de sesiones reanudables respaldado por Redis. Es la opción recomendada para producción: ofrece rendimiento de lectura/escritura sub-milisegundo, soporte nativo de TTL (expiración automática) y compatibilidad con arquitecturas multi-instancia.

## Instalación

```bash
dotnet add package ValiBlob.Redis
```

## Configuración básica

```csharp
using ValiBlob.Core.Extensions;
using ValiBlob.Redis;

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts => { /* ... */ })
    .UseRedisResumableStore(redis =>
    {
        redis.ConnectionString = builder.Configuration["Redis:ConnectionString"]!;
    });
```

## RedisResumableStoreOptions

```csharp
public class RedisResumableStoreOptions
{
    /// <summary>Cadena de conexión de Redis (formato StackExchange.Redis). Requerida.</summary>
    public required string ConnectionString { get; set; }

    /// <summary>Índice de la base de datos Redis (0-15). Por defecto: 0.</summary>
    public int DatabaseIndex { get; set; } = 0;

    /// <summary>Prefijo para todas las claves de sesión. Por defecto: "valiblob:sessions".</summary>
    public string KeyPrefix { get; set; } = "valiblob:sessions";

    /// <summary>TTL predeterminado para las sesiones en Redis. Por defecto: 24 horas.</summary>
    public TimeSpan DefaultSessionTtl { get; set; } = TimeSpan.FromHours(24);

    /// <summary>Si true, comprimir los datos JSON de sesión antes de almacenar.</summary>
    public bool CompressSessionData { get; set; } = false;
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `ConnectionString` | — | Cadena de conexión de Redis. Requerida. |
| `DatabaseIndex` | `0` | Base de datos Redis (0–15). Usa una dedicada para ValiBlob |
| `KeyPrefix` | `valiblob:sessions` | Prefijo de todas las claves en Redis |
| `DefaultSessionTtl` | `24 horas` | TTL aplicado a cada sesión al crearla |
| `CompressSessionData` | `false` | Comprimir el JSON de sesión con GZip antes de guardar |

## Formatos de ConnectionString

```bash
# Instancia local
localhost:6379

# Con autenticación
redis.empresa.com:6379,password=miContraseña

# Con TLS (Redis en la nube)
redis.empresa.com:6380,ssl=true,password=miContraseña

# Azure Cache for Redis
mi-cache.redis.cache.windows.net:6380,password=CLAVE_PRIMARIA,ssl=True,abortConnect=False

# Redis Sentinel (alta disponibilidad)
sentinel1:26379,sentinel2:26379,sentinel3:26379,serviceName=mymaster

# Redis Cluster
redis-node1:6379,redis-node2:6379,redis-node3:6379
```

## Reutilizar IConnectionMultiplexer existente

Si tu aplicación ya tiene un `IConnectionMultiplexer` registrado (por ejemplo, para caché), ValiBlob lo reutiliza automáticamente:

```csharp
// Registro compartido del multiplexer
builder.Services.AddSingleton<IConnectionMultiplexer>(
    ConnectionMultiplexer.Connect(builder.Configuration["Redis:ConnectionString"]!));

// ValiBlob detecta y reutiliza el multiplexer existente
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "s3")
    .AddProvider<AWSS3Provider>("s3", opts => { /* ... */ })
    .UseRedisResumableStore(redis =>
    {
        redis.DatabaseIndex = 2;  // Base de datos separada para sesiones ValiBlob
        redis.KeyPrefix = "storage:sessions";
        // Sin ConnectionString: usa el IConnectionMultiplexer del contenedor DI
    });
```

## Configuración desde appsettings.json

```json
{
  "Redis": {
    "ConnectionString": "localhost:6379",
    "DatabaseIndex": 1,
    "KeyPrefix": "valiblob",
    "DefaultSessionTtlHours": 48
  }
}
```

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "s3")
    .AddProvider<AWSS3Provider>("s3", opts => { /* ... */ })
    .UseRedisResumableStore(
        builder.Configuration.GetSection("Redis").Bind);
```

## Estructura de datos en Redis

Las sesiones se almacenan como hashes Redis:

```
valiblob:sessions:{sessionId}:meta   → Hash con todos los campos de la sesión
valiblob:sessions:{sessionId}:chunks → Set con índices de chunks recibidos
```

Inspección desde `redis-cli`:

```bash
# Ver todos los campos de una sesión
HGETALL "valiblob:sessions:abc123:meta"
# path          → "uploads/mi-archivo.zip"
# totalBytes    → "104857600"
# uploadedBytes → "52428800"
# status        → "Active"
# createdAt     → "2024-03-15T10:00:00Z"
# expiresAt     → "2024-03-17T10:00:00Z"

# Ver TTL restante de la sesión
TTL "valiblob:sessions:abc123:meta"
# Resultado: 172800 (segundos = 48 horas restantes)

# Contar sesiones activas
KEYS "valiblob:sessions:*:meta"
```

## TTL y expiración automática

Una de las principales ventajas de Redis es el TTL nativo. No se necesita un job de limpieza manual:

```csharp
.UseRedisResumableStore(redis =>
{
    redis.DefaultSessionTtl = TimeSpan.FromHours(48);
    // Redis eliminará automáticamente las sesiones expiradas
})
```

Cuando un cliente intenta usar una sesión expirada:

```csharp
var resultado = await storage.UploadChunkAsync(new UploadChunkRequest
{
    SessionId = sessionIdExpirado,
    // ...
}, ct);

if (resultado.ErrorCode == StorageErrorCode.ResumableSessionExpired)
{
    return Results.StatusCode(410); // 410 Gone — la sesión ya no existe
}

if (resultado.ErrorCode == StorageErrorCode.ResumableSessionNotFound)
{
    return Results.NotFound("Sesión no encontrada.");
}
```

## Configuración completa en producción

```csharp
// Program.cs — AWS S3 + Azure Cache for Redis
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "s3")
    .AddProvider<AWSS3Provider>("s3", opts =>
    {
        opts.BucketName = builder.Configuration["AWS:BucketName"]!;
        opts.Region = builder.Configuration["AWS:Region"]!;
    })
    .WithPipeline(p => p
        .UseValidation(v => v.MaxFileSizeBytes = 5_000_000_000L) // 5 GB
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    )
    .UseRedisResumableStore(redis =>
    {
        redis.ConnectionString = builder.Configuration["Redis:ConnectionString"]!;
        redis.DatabaseIndex = 1;
        redis.KeyPrefix = $"{builder.Configuration["App:Name"]}:sessions";
        redis.DefaultSessionTtl = TimeSpan.FromHours(72); // 3 días
        redis.CompressSessionData = false;
    });
```

:::tip Consejo
Usa un `DatabaseIndex` dedicado (ej. `DatabaseIndex = 1`) para las sesiones de ValiBlob, separado de otros usos de Redis como caché de aplicación o colas. Esto facilita la inspección con `redis-cli`, el monitoreo de uso y el flush selectivo de datos sin afectar otros sistemas.
:::

:::warning Advertencia
Configura Redis con la política de evicción `noeviction` o `volatile-lru` para las sesiones de ValiBlob. Si Redis expulsa claves activas por presión de memoria antes de que expiren por TTL, la sesión de subida se perderá prematuramente y el cliente recibirá `ResumableSessionNotFound`. Monitorea el uso de memoria de Redis en producción.
:::
