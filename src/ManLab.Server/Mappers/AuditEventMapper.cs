using ManLab.Server.Data.Entities;
using ManLab.Shared.Dtos;
using Riok.Mapperly.Abstractions;

namespace ManLab.Server.Mappers;

/// <summary>
/// Source-generated mapper for AuditEvent <-> AuditEventDto conversions.
/// Uses Mapperly for zero-runtime-overhead mapping.
/// 
/// MAINTENANCE GUIDE:
/// =================
/// When adding new properties to AuditEvent or AuditEventDto:
/// 
/// 1. BOTH classes MUST have the property with EXACT same name and compatible type
/// 2. Property names are CASE-SENSITIVE (Mapperly will fail to compile if mismatched)
/// 3. Run the AuditEventMapperTests to verify mapping works
/// 4. Build will FAIL if properties don't match - this is intentional to catch errors early
/// 
/// Configuration:
/// - PropertyNameMappingStrategy.CaseSensitive: Exact name matching required
/// - ThrowOnMappingNullMismatch = false: Allows null values to be mapped
/// - ThrowOnPropertyMappingNullMismatch = false: Allows null property values
/// 
/// The build will fail with RMGxxx errors if:
/// - A property exists in one class but not the other
/// - Property types are incompatible
/// - Property names differ in casing
/// 
/// To debug mapping issues, check the generated code at:
/// obj/Debug/net10.0/Riok.Mapperly/Riok.Mapperly.MapperGenerator/ManLab.Server.Mappers.AuditEventMapper.g.cs
/// </summary>
[Mapper(
    PropertyNameMappingStrategy = PropertyNameMappingStrategy.CaseSensitive,
    ThrowOnMappingNullMismatch = false,
    ThrowOnPropertyMappingNullMismatch = false)]
public static partial class AuditEventMapper
{
    /// <summary>
    /// Maps an AuditEvent entity to an AuditEventDto for NATS serialization.
    /// </summary>
    public static partial AuditEventDto ToDto(this AuditEvent entity);

    /// <summary>
    /// Maps an AuditEventDto to an AuditEvent entity for database persistence.
    /// </summary>
    public static partial AuditEvent ToEntity(this AuditEventDto dto);

    /// <summary>
    /// Maps a collection of AuditEventDto to AuditEvent entities.
    /// </summary>
    public static partial IEnumerable<AuditEvent> ToEntities(this IEnumerable<AuditEventDto> dtos);
}
