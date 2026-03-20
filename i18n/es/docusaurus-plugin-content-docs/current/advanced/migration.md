---
title: Migración entre Proveedores
sidebar_label: Migración
---

# Migración entre Proveedores

`IStorageMigrator` permite migrar archivos de un proveedor de almacenamiento a otro. Soporta modo DryRun para simular la migración sin realizar cambios, migración parcial por prefijo, paralelismo configurable y eliminación del origen tras la copia.

## IStorageMigrator

```csharp
public interface IStorageMigrator
{
    Task<MigrationResult> MigrateAsync(
        IStorageProvider source,
        IStorageProvider destination,
        MigrationOptions options,
        CancellationToken ct = default);
}
```

## MigrationOptions

```csharp
public class MigrationOptions
{
    /// <summary>Si true, simula la migración sin copiar archivos. Por defecto: false.</summary>
    public bool DryRun { get; set; } = false;

    /// <summary>Si true, omite archivos que ya existen en el destino. Por defecto: true.</summary>
    public bool SkipExisting { get; set; } = true;

    /// <summary>Si true, elimina archivos del origen después de copiarlos al destino.</summary>
    public bool DeleteSourceAfterCopy { get; set; } = false;

    /// <summary>Prefijo del origen a migrar. Vacío = migrar todo.</summary>
    public string SourcePrefix { get; set; } = "";

    /// <summary>Prefijo a agregar en el destino. Vacío = misma ruta que el origen.</summary>
    public string DestinationPrefix { get; set; } = "";

    /// <summary>Número de archivos a migrar en paralelo. Por defecto: 4.</summary>
    public int DegreeOfParallelism { get; set; } = 4;

    /// <summary>Callback para reportar progreso durante la migración.</summary>
    public Action<MigrationProgress>? OnProgress { get; set; }

    /// <summary>Si true, continúa aunque falle algún archivo. Si false, aborta al primer error.</summary>
    public bool ContinueOnError { get; set; } = true;
}
```

## MigrationResult

```csharp
public class MigrationResult
{
    public int TotalFiles { get; init; }
    public int CopiedFiles { get; init; }
    public int SkippedFiles { get; init; }
    public int FailedFiles { get; init; }
    public long TotalBytesTransferred { get; init; }
    public TimeSpan Duration { get; init; }
    public bool WasDryRun { get; init; }
    public IReadOnlyList<MigrationError> Errors { get; init; } = [];
    public bool IsSuccess => FailedFiles == 0;
}
```

## Registro

```csharp
builder.Services.AddScoped<IStorageMigrator, DefaultStorageMigrator>();
```

## Migración de AWS S3 a Azure Blob Storage

```csharp
public class ServicioMigracion(
    IStorageMigrator migrator,
    [FromKeyedServices("aws")] IStorageProvider aws,
    [FromKeyedServices("azure")] IStorageProvider azure,
    ILogger<ServicioMigracion> logger)
{
    public async Task<MigrationResult> MigrarAsync(CancellationToken ct)
    {
        logger.LogInformation("Iniciando migración de AWS S3 a Azure Blob Storage...");

        var resultado = await migrator.MigrateAsync(
            source: aws,
            destination: azure,
            options: new MigrationOptions
            {
                DryRun = false,
                SkipExisting = true,
                DeleteSourceAfterCopy = false,  // Mantener origen como respaldo
                DegreeOfParallelism = 8,
                ContinueOnError = true,
                OnProgress = progreso =>
                {
                    if (progreso.ProcessedFiles % 100 == 0)
                        logger.LogInformation(
                            "Progreso: {Procesados}/{Total} ({Porcentaje}%) — {Actual}",
                            progreso.ProcessedFiles, progreso.TotalFiles,
                            progreso.ProgressPercent, progreso.CurrentFile);
                }
            },
            ct);

        logger.LogInformation(
            "Migración completada. Copiados: {C}, Omitidos: {O}, Errores: {E}, Bytes: {B:N0}",
            resultado.CopiedFiles, resultado.SkippedFiles,
            resultado.FailedFiles, resultado.TotalBytesTransferred);

        return resultado;
    }
}
```

## Modo DryRun: simular antes de ejecutar

```csharp
// 1. Simular para conocer el alcance
var simulacion = await migrator.MigrateAsync(
    source: aws,
    destination: azure,
    options: new MigrationOptions
    {
        DryRun = true,
        SourcePrefix = "documentos/",
        SkipExisting = true
    },
    ct);

Console.WriteLine($"=== Simulación de migración ===");
Console.WriteLine($"Archivos totales:    {simulacion.TotalFiles}");
Console.WriteLine($"Archivos a copiar:   {simulacion.CopiedFiles}");
Console.WriteLine($"Archivos a omitir:   {simulacion.SkippedFiles}");
Console.WriteLine($"Tamaño estimado:     {simulacion.TotalBytesTransferred / 1_048_576.0:F1} MB");
Console.WriteLine($"(DRY RUN — ningún archivo fue modificado)");

// 2. Si el resultado es aceptable, ejecutar la migración real
var resultadoReal = await migrator.MigrateAsync(
    source: aws,
    destination: azure,
    options: new MigrationOptions
    {
        DryRun = false,
        SourcePrefix = "documentos/",
        SkipExisting = true,
        DegreeOfParallelism = 4
    },
    ct);
```

## Migración parcial por prefijo con reorganización

```csharp
// Migrar carpeta "facturas/2023/" y moverla a "archivo/facturas/2023/"
var resultado = await migrator.MigrateAsync(
    source: origenProvider,
    destination: destinoProvider,
    options: new MigrationOptions
    {
        SourcePrefix = "facturas/2023/",
        DestinationPrefix = "archivo/facturas/2023/", // Reorganizar en destino
        SkipExisting = true,
        DeleteSourceAfterCopy = false,
        DegreeOfParallelism = 4
    },
    ct);
```

## Mover archivos (copiar + eliminar origen)

```csharp
// Mover archivos de Local a S3
var resultado = await migrator.MigrateAsync(
    source: localStorage,
    destination: s3Storage,
    options: new MigrationOptions
    {
        DryRun = false,
        SkipExisting = true,
        DeleteSourceAfterCopy = true,  // Eliminar del origen tras copiar
        ContinueOnError = false,       // Abortar si hay algún error
        DegreeOfParallelism = 2        // Conservador para no saturar la red local
    },
    ct);

if (!resultado.IsSuccess)
{
    foreach (var error in resultado.Errors)
        Console.WriteLine($"Error en {error.SourcePath}: {error.ErrorMessage}");
}
```

## Endpoint de migración para administradores

```csharp
app.MapPost("/admin/storage/migrar", async (
    [FromBody] SolicitudMigracion solicitud,
    IStorageMigrator migrator,
    IServiceProvider services,
    CancellationToken ct) =>
{
    var origen = services.GetRequiredKeyedService<IStorageProvider>(solicitud.ProveedorOrigen);
    var destino = services.GetRequiredKeyedService<IStorageProvider>(solicitud.ProveedorDestino);

    // Siempre hacer DryRun primero si se solicita
    if (solicitud.SoloDryRun)
    {
        var simulacion = await migrator.MigrateAsync(origen, destino,
            new MigrationOptions { DryRun = true, SkipExisting = true }, ct);

        return Results.Ok(new
        {
            esDryRun = true,
            archivosACopiar = simulacion.CopiedFiles,
            archivosAOmitir = simulacion.SkippedFiles,
            mbEstimados = simulacion.TotalBytesTransferred / 1_048_576.0
        });
    }

    // Ejecución real
    var resultado = await migrator.MigrateAsync(origen, destino,
        new MigrationOptions
        {
            DryRun = false,
            SkipExisting = true,
            DeleteSourceAfterCopy = solicitud.EliminarOrigen,
            DegreeOfParallelism = solicitud.Paralelismo
        },
        ct);

    return Results.Ok(new
    {
        exitoso = resultado.IsSuccess,
        copiados = resultado.CopiedFiles,
        omitidos = resultado.SkippedFiles,
        errores = resultado.FailedFiles,
        mbTransferidos = resultado.TotalBytesTransferred / 1_048_576.0,
        duracion = resultado.Duration.ToString(@"hh\:mm\:ss"),
        erroresDetalle = resultado.Errors.Select(e => new { e.SourcePath, e.ErrorMessage })
    });
}).RequireAuthorization("Admin");
```

:::tip Consejo
Siempre ejecuta primero una migración en modo **DryRun** para verificar el alcance y detectar posibles problemas (archivos no accesibles, errores de permisos, tamaño total) antes de realizar cambios reales. Documenta el resultado del DryRun como referencia del estado inicial.
:::

:::warning Advertencia
Con `DeleteSourceAfterCopy = true`, los archivos se eliminan del origen inmediatamente después de ser copiados al destino. Si la migración se interrumpe, algunos archivos habrán sido eliminados del origen pero aún no todos estarán en el destino. Haz siempre una copia de seguridad completa antes de cualquier migración con eliminación.
:::
