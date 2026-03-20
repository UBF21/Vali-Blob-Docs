---
title: Cuota de Almacenamiento
sidebar_label: Cuota
---

# Cuota de Almacenamiento

El `QuotaMiddleware` verifica el espacio disponible antes de almacenar un archivo. Si la subida supera la cuota configurada, la operación se cancela con `StorageErrorCode.QuotaExceeded`. Permite implementar límites de almacenamiento por usuario, tenant o de forma global.

## Activación

```csharp
.WithPipeline(p => p
    .UseQuota(q =>
    {
        q.MaxTotalBytes = 10L * 1024 * 1024 * 1024; // 10 GB total global
    })
)
```

## QuotaOptions

```csharp
public class QuotaOptions
{
    /// <summary>Tamaño máximo total en bytes para todo el almacenamiento. null = sin límite global.</summary>
    public long? MaxTotalBytes { get; set; }

    /// <summary>Tamaño máximo por prefijo/carpeta en bytes. null = sin límite por carpeta.</summary>
    public long? MaxBytesPerPrefix { get; set; }

    /// <summary>Si true, incluye el tamaño del archivo actual en la verificación previa. Por defecto: true.</summary>
    public bool IncludeCurrentFileInCheck { get; set; } = true;

    /// <summary>Función para resolver la clave de cuota a partir del contexto del request.</summary>
    public Func<StoragePipelineContext, string>? QuotaKeyResolver { get; set; }
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `MaxTotalBytes` | `null` | Límite global en bytes. Si está definido, aplica a todos los uploads |
| `MaxBytesPerPrefix` | `null` | Límite por directorio/carpeta |
| `IncludeCurrentFileInCheck` | `true` | Verificar si el archivo a subir cabe antes de iniciarlo |
| `QuotaKeyResolver` | `null` | Función para determinar la clave de cuota (por usuario, tenant, etc.) |

## IStorageQuotaService

ValiBlob incluye `InMemoryStorageQuotaService` para desarrollo. Para producción, implementa esta interfaz:

```csharp
public interface IStorageQuotaService
{
    /// <summary>Obtiene el uso actual en bytes para una clave de cuota.</summary>
    Task<long> GetCurrentUsageBytesAsync(string quotaKey, CancellationToken ct = default);

    /// <summary>Registra el uso de almacenamiento después de una subida exitosa.</summary>
    Task RecordUsageAsync(string quotaKey, long bytes, CancellationToken ct = default);

    /// <summary>Libera espacio cuando un archivo es eliminado.</summary>
    Task ReleaseUsageAsync(string quotaKey, long bytes, CancellationToken ct = default);

    /// <summary>Obtiene el límite de cuota configurado para una clave.</summary>
    Task<long?> GetQuotaLimitBytesAsync(string quotaKey, CancellationToken ct = default);
}
```

## Implementación con Redis (multi-instancia)

```csharp
public class RedisQuotaService(
    IConnectionMultiplexer redis,
    IOptions<CuotaOptions> opciones) : IStorageQuotaService
{
    private readonly IDatabase _db = redis.GetDatabase();

    public async Task<long> GetCurrentUsageBytesAsync(string quotaKey, CancellationToken ct)
    {
        var valor = await _db.StringGetAsync($"cuota:uso:{quotaKey}");
        return valor.HasValue ? (long)valor : 0;
    }

    public async Task RecordUsageAsync(string quotaKey, long bytes, CancellationToken ct)
    {
        await _db.StringIncrementAsync($"cuota:uso:{quotaKey}", bytes);
    }

    public async Task ReleaseUsageAsync(string quotaKey, long bytes, CancellationToken ct)
    {
        await _db.StringDecrementAsync($"cuota:uso:{quotaKey}", bytes);
    }

    public async Task<long?> GetQuotaLimitBytesAsync(string quotaKey, CancellationToken ct)
    {
        var limiteClave = $"cuota:limite:{quotaKey}";
        var valor = await _db.StringGetAsync(limiteClave);

        if (valor.HasValue) return (long)valor;

        // Límite por defecto para usuarios sin límite configurado explícitamente
        return opciones.Value.LimiteDefaultBytes;
    }
}

// Registro
builder.Services.AddSingleton<IStorageQuotaService, RedisQuotaService>();
```

## Implementación con Entity Framework Core

```csharp
public class EFCoreQuotaService(AppDbContext db) : IStorageQuotaService
{
    public async Task<long> GetCurrentUsageBytesAsync(string quotaKey, CancellationToken ct)
    {
        var cuota = await db.CuotasAlmacenamiento
            .FirstOrDefaultAsync(q => q.Clave == quotaKey, ct);
        return cuota?.BytesUsados ?? 0;
    }

    public async Task RecordUsageAsync(string quotaKey, long bytes, CancellationToken ct)
    {
        var cuota = await db.CuotasAlmacenamiento
            .FirstOrDefaultAsync(q => q.Clave == quotaKey, ct);

        if (cuota is null)
        {
            cuota = new CuotaAlmacenamiento { Clave = quotaKey, BytesUsados = bytes };
            db.CuotasAlmacenamiento.Add(cuota);
        }
        else
        {
            cuota.BytesUsados += bytes;
            cuota.ActualizadoEn = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
    }

    public async Task ReleaseUsageAsync(string quotaKey, long bytes, CancellationToken ct)
    {
        await db.CuotasAlmacenamiento
            .Where(q => q.Clave == quotaKey)
            .ExecuteUpdateAsync(s => s
                .SetProperty(q => q.BytesUsados, q => Math.Max(0, q.BytesUsados - bytes))
                .SetProperty(q => q.ActualizadoEn, DateTime.UtcNow), ct);
    }

    public async Task<long?> GetQuotaLimitBytesAsync(string quotaKey, CancellationToken ct)
    {
        return await db.Usuarios
            .Where(u => u.Id == quotaKey)
            .Select(u => (long?)u.LimiteCuotaBytes)
            .FirstOrDefaultAsync(ct) ?? 1_073_741_824L; // 1 GB por defecto
    }
}
```

## Cuota por usuario (multi-tenant)

```csharp
.UseQuota(q =>
{
    q.MaxTotalBytes = null; // El límite lo define IStorageQuotaService por usuario
    q.QuotaKeyResolver = context =>
    {
        // La ruta tiene el formato: "{userId}/archivos/foto.jpg"
        var segmentos = context.UploadRequest?.Path?.Split('/');
        return segmentos?.Length > 0 ? segmentos[0] : "global";
    };
})
```

```csharp
// Subida con cuota por usuario
app.MapPost("/api/archivos", async (
    IFormFile archivo,
    ClaimsPrincipal usuario,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    var userId = usuario.FindFirstValue(ClaimTypes.NameIdentifier)!;

    await using var stream = archivo.OpenReadStream();
    var resultado = await storage.UploadAsync(new UploadRequest
    {
        // El path incluye el userId para que QuotaKeyResolver lo extraiga
        Path = StoragePath.From(userId, "archivos", StoragePath.Sanitize(archivo.FileName)),
        Content = stream,
        ContentType = archivo.ContentType,
        KnownSize = archivo.Length
    }, ct);

    if (resultado.ErrorCode == StorageErrorCode.QuotaExceeded)
        return Results.StatusCode(507); // 507 Insufficient Storage

    return resultado.IsSuccess
        ? Results.Created($"/api/archivos/{resultado.Value!.Path}", null)
        : Results.BadRequest(resultado.ErrorMessage);
}).RequireAuthorization();
```

## Endpoint de consulta de cuota

```csharp
app.MapGet("/api/mi-cuota", async (
    ClaimsPrincipal usuario,
    IStorageQuotaService quotaService,
    CancellationToken ct) =>
{
    var userId = usuario.FindFirstValue(ClaimTypes.NameIdentifier)!;

    var usado = await quotaService.GetCurrentUsageBytesAsync(userId, ct);
    var limite = await quotaService.GetQuotaLimitBytesAsync(userId, ct) ?? long.MaxValue;
    var disponible = Math.Max(0, limite - usado);
    var porcentaje = limite > 0 ? (double)usado / limite * 100 : 0;

    return Results.Ok(new
    {
        usadoBytes = usado,
        limiteBytes = limite,
        disponibleBytes = disponible,
        usadoMb = Math.Round(usado / 1_048_576.0, 2),
        limiteMb = Math.Round(limite / 1_048_576.0, 2),
        porcentajeUso = Math.Round(porcentaje, 1)
    });
}).RequireAuthorization();
```

## Manejar el error de cuota excedida

```csharp
var resultado = await storage.UploadAsync(request, ct);

if (!resultado.IsSuccess && resultado.ErrorCode == StorageErrorCode.QuotaExceeded)
{
    var usado = await quotaService.GetCurrentUsageBytesAsync(userId, ct);
    var limite = await quotaService.GetQuotaLimitBytesAsync(userId, ct) ?? 0;

    return Results.Json(new
    {
        error = "CUOTA_EXCEDIDA",
        mensaje = "Has alcanzado tu límite de almacenamiento.",
        usadoMb = Math.Round(usado / 1_048_576.0, 1),
        limiteMb = Math.Round(limite / 1_048_576.0, 1),
        accion = "Elimina archivos existentes o actualiza tu plan para continuar."
    }, statusCode: 507);
}
```

:::tip Consejo
Combina el middleware de cuota con el evento `QuotaExceededEvent` para enviar notificaciones por email cuando un usuario alcanza su límite, y con un webhook o banner en la interfaz cuando está al 80% o 90% de uso.
:::

:::warning Advertencia
La implementación en memoria `InMemoryStorageQuotaService` pierde el estado al reiniciar la aplicación y no funciona correctamente con múltiples instancias del servidor. Usa Redis o base de datos en cualquier entorno con más de una instancia o que requiera persistencia del contador de uso.
:::

:::info Información
El middleware de cuota verifica el espacio **antes** de iniciar la subida usando `KnownSize` del `UploadRequest`. Si `KnownSize` no está definido, la verificación se hace estimando el tamaño disponible. Proporciona siempre `KnownSize` para una verificación de cuota exacta.
:::
