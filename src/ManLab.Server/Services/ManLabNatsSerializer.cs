using ManLab.Shared.Dtos;
using NATS.Client.Core;
using NATS.Client.Serializers.Json;
using System.Buffers;

namespace ManLab.Server.Services;

/// <summary>
/// Hybrid serializer that uses source-generated JSON for types in ManLabJsonContext,
/// falling back to the default NATS serializer for other types.
/// This provides optimal performance for known types while maintaining compatibility.
/// </summary>
public sealed class ManLabNatsSerializer<T> : INatsSerializer<T>
{
    private static readonly NatsJsonContextSerializer<T>? JsonSerializer;
    // Fallback to reflection-based JSON serializer which supports any type
    private static readonly INatsSerializer<T> FallbackSerializer = NatsJsonSerializer<T>.Default;

    static ManLabNatsSerializer()
    {
        // Check if the type is in our JSON context
        var typeInfo = ManLabJsonContext.Default.GetTypeInfo(typeof(T));
        if (typeInfo != null)
        {
            JsonSerializer = new NatsJsonContextSerializer<T>(ManLabJsonContext.Default);
        }
    }

    public static readonly INatsSerializer<T> Default = new ManLabNatsSerializer<T>();

    public void Serialize(IBufferWriter<byte> bufferWriter, T value)
    {
        if (JsonSerializer is not null)
        {
            JsonSerializer.Serialize(bufferWriter, value);
        }
        else
        {
            FallbackSerializer.Serialize(bufferWriter, value);
        }
    }

    public T? Deserialize(in ReadOnlySequence<byte> buffer)
    {
        if (JsonSerializer is not null)
        {
            return JsonSerializer.Deserialize(buffer);
        }
        else
        {
            return FallbackSerializer.Deserialize(buffer);
        }
    }

    public INatsSerializer<T> CombineWith(INatsSerializer<T> next) => FallbackSerializer.CombineWith(next);
}

/// <summary>
/// Serializer registry that uses source-generated JSON for known types
/// and falls back to default NATS serializer for other types.
/// </summary>
public sealed class ManLabNatsSerializerRegistry : INatsSerializerRegistry
{
    public static readonly ManLabNatsSerializerRegistry Instance = new();

    public INatsSerialize<T> GetSerializer<T>() => ManLabNatsSerializer<T>.Default;

    public INatsDeserialize<T> GetDeserializer<T>() => ManLabNatsSerializer<T>.Default;
}
