---
title: Integración CDN
sidebar_label: CDN
---

# Integración CDN

ValiBlob permite mapear rutas de almacenamiento a URLs de CDN, de forma que los archivos públicos se sirvan desde la caché de la CDN en lugar del proveedor de almacenamiento directamente. Esto reduce la latencia y los costos de transferencia.

## ICdnProvider

```csharp
public interface ICdnProvider
{
    /// <summary>Transforma una ruta de almacenamiento en una URL de CDN.</summary>
    string GetCdnUrl(string storagePath);

    /// <summary>Invalida la caché de la CDN para una ruta específica.</summary>
    Task<bool> InvalidateCacheAsync(string storagePath, CancellationToken ct = default);

    /// <summary>Invalida múltiples rutas en la CDN simultáneamente.</summary>
    Task<bool> InvalidateCacheAsync(IEnumerable<string> paths, CancellationToken ct = default);
}
```

## PrefixCdnProvider (incluido)

La implementación más simple: reemplaza el prefijo de almacenamiento con la URL base de la CDN.

```csharp
public class PrefixCdnProvider(CdnOptions options) : ICdnProvider
{
    public string GetCdnUrl(string storagePath)
    {
        var rutaNormalizada = storagePath.TrimStart('/');
        return $"{options.BaseUrl.TrimEnd('/')}/{rutaNormalizada}";
    }

    public Task<bool> InvalidateCacheAsync(string storagePath, CancellationToken ct)
        => Task.FromResult(true);

    public Task<bool> InvalidateCacheAsync(IEnumerable<string> paths, CancellationToken ct)
        => Task.FromResult(true);
}
```

## CdnOptions

```csharp
public class CdnOptions
{
    /// <summary>URL base de la CDN. Ejemplo: "https://cdn.miempresa.com"</summary>
    public required string BaseUrl { get; set; }

    /// <summary>Mapeo de prefijos: rutas que inician con Key se sirven desde Value.</summary>
    public Dictionary<string, string> PathMappings { get; set; } = new();
}
```

## Configuración por proveedor CDN

### Amazon CloudFront

```csharp
builder.Services.Configure<CdnOptions>(opts =>
{
    opts.BaseUrl = "https://d1234567890.cloudfront.net";
    opts.PathMappings = new Dictionary<string, string>
    {
        ["imagenes/"] = "https://img.miempresa.com",
        ["videos/"] = "https://media.miempresa.com"
    };
});

builder.Services.AddSingleton<ICdnProvider, PrefixCdnProvider>();
```

### Azure CDN con invalidación

```csharp
public class AzureCdnProvider(CdnOptions opciones, ArmClient armClient) : ICdnProvider
{
    public string GetCdnUrl(string storagePath) =>
        $"{opciones.BaseUrl.TrimEnd('/')}/{storagePath.TrimStart('/')}";

    public Task<bool> InvalidateCacheAsync(string storagePath, CancellationToken ct)
        => InvalidateCacheAsync([storagePath], ct);

    public async Task<bool> InvalidateCacheAsync(IEnumerable<string> paths, CancellationToken ct)
    {
        var endpoint = armClient.GetCdnEndpointResource(
            ResourceIdentifier.Parse(opciones.EndpointResourceId));

        var contenidoPurge = new PurgeContent(
            paths.Select(p => $"/{p.TrimStart('/')}").ToList());

        await endpoint.PurgeContentAsync(WaitUntil.Completed, contenidoPurge, ct);
        return true;
    }
}

// Registro
builder.Services.AddSingleton<ICdnProvider, AzureCdnProvider>();
```

### Google Cloud CDN / Cloudflare

```csharp
builder.Services.Configure<CdnOptions>(opts =>
{
    opts.BaseUrl = "https://cdn.miempresa.com"; // Dominio configurado con Cloud CDN
});

builder.Services.AddSingleton<ICdnProvider, PrefixCdnProvider>();
```

## Uso del ICdnProvider

```csharp
public class ServicioArchivosPublicos(
    IStorageProvider storage,
    ICdnProvider cdn)
{
    public async Task<string?> SubirYObtenerUrlCdnAsync(
        Stream contenido,
        string nombre,
        CancellationToken ct)
    {
        var ruta = StoragePath.From("publico", StoragePath.Sanitize(nombre));

        var resultado = await storage.UploadAsync(new UploadRequest
        {
            Path = ruta,
            Content = contenido
        }, ct);

        if (!resultado.IsSuccess) return null;

        // Devolver URL de CDN en lugar de URL del proveedor
        return cdn.GetCdnUrl(resultado.Value!.Path);
    }
}
```

## Mapeo de rutas múltiples

Para servir diferentes prefijos desde diferentes sub-dominios de CDN:

```csharp
public class MultiPathCdnProvider(CdnOptions opciones) : ICdnProvider
{
    public string GetCdnUrl(string storagePath)
    {
        // Buscar el mapeo más específico (mayor longitud del prefijo)
        foreach (var (prefijo, urlBase) in opciones.PathMappings
            .OrderByDescending(kv => kv.Key.Length))
        {
            if (storagePath.StartsWith(prefijo, StringComparison.OrdinalIgnoreCase))
            {
                var rutaRelativa = storagePath[prefijo.Length..];
                return $"{urlBase.TrimEnd('/')}/{rutaRelativa}";
            }
        }

        // Fallback a la URL base general
        return $"{opciones.BaseUrl.TrimEnd('/')}/{storagePath.TrimStart('/')}";
    }

    public Task<bool> InvalidateCacheAsync(string storagePath, CancellationToken ct)
        => Task.FromResult(true);

    public Task<bool> InvalidateCacheAsync(IEnumerable<string> paths, CancellationToken ct)
        => Task.FromResult(true);
}

// Configuración
builder.Services.Configure<CdnOptions>(opts =>
{
    opts.BaseUrl = "https://cdn.miempresa.com";
    opts.PathMappings = new Dictionary<string, string>
    {
        ["imagenes/producto/"] = "https://img.mitienda.com",
        ["imagenes/"] = "https://img.miempresa.com",
        ["documentos/publicos/"] = "https://docs.miempresa.com"
    };
});

builder.Services.AddSingleton<ICdnProvider, MultiPathCdnProvider>();
```

## Invalidar caché al actualizar archivos

```csharp
public class ServicioContenidoPublico(
    IStorageProvider storage,
    ICdnProvider cdn,
    ILogger<ServicioContenidoPublico> logger)
{
    public async Task ActualizarArchivoAsync(
        string ruta,
        Stream nuevoContenido,
        CancellationToken ct)
    {
        // 1. Actualizar en el proveedor de almacenamiento
        var resultado = await storage.UploadAsync(new UploadRequest
        {
            Path = ruta,
            Content = nuevoContenido,
            Overwrite = true
        }, ct);

        if (!resultado.IsSuccess)
        {
            logger.LogError("Error al actualizar {Ruta}: {Error}", ruta, resultado.ErrorMessage);
            return;
        }

        // 2. Invalidar la caché de la CDN para que se sirva el nuevo archivo
        var invalidado = await cdn.InvalidateCacheAsync(ruta, ct);

        logger.LogInformation(
            "Archivo actualizado: {Ruta}. Caché CDN invalidada: {Invalidado}",
            ruta, invalidado);
    }
}
```

## Transformación de URL en endpoints de API

```csharp
app.MapGet("/api/catalogo", async (
    IStorageProvider storage,
    ICdnProvider cdn,
    CancellationToken ct) =>
{
    var archivos = await storage.ListFilesAsync("catalogo/", ct);
    if (!archivos.IsSuccess) return Results.StatusCode(500);

    var items = archivos.Value!.Select(archivo => new
    {
        ruta = archivo.Path,
        urlCdn = cdn.GetCdnUrl(archivo.Path),  // URL optimizada desde CDN
        tamanoBytes = archivo.SizeBytes,
        ultimaModificacion = archivo.LastModified
    });

    return Results.Ok(items);
});
```

:::tip Consejo
Para archivos estáticos que cambian raramente (logos, assets CSS/JS), configura TTLs de CDN largos (86400–31536000 segundos) y versiona los archivos incluyendo un hash en el nombre (`logo.abc123.svg`). Para contenido dinámico, usa TTLs cortos o implementa invalidación automática al subir.
:::

:::info Información
La integración CDN de ValiBlob solo maneja la generación de URLs y la invalidación programática. La configuración del origen, las reglas de caché, los certificados SSL y la distribución deben configurarse directamente en el panel del proveedor CDN (CloudFront, Azure CDN, Cloudflare, Cloud CDN).
:::
