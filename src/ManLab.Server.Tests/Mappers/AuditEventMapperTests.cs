using ManLab.Server.Data.Entities;
using ManLab.Server.Mappers;
using ManLab.Shared.Dtos;
using Xunit;

namespace ManLab.Server.Tests.Mappers;

/// <summary>
/// Tests for AuditEventMapper to verify property mapping completeness.
/// These tests ensure all properties are mapped correctly and catch any future changes.
/// </summary>
public class AuditEventMapperTests
{
    [Fact]
    public void ToDto_MapsAllProperties()
    {
        var entity = new AuditEvent
        {
            Id = Guid.NewGuid(),
            TimestampUtc = DateTime.UtcNow,
            Kind = "audit",
            EventName = "test.event",
            Category = "test",
            Message = "Test message",
            Success = true,
            Source = "http",
            ActorType = "user",
            ActorId = "user123",
            ActorName = "Test User",
            ActorIp = "192.168.1.1",
            UserAgent = "Mozilla/5.0",
            NodeId = Guid.NewGuid(),
            CommandId = Guid.NewGuid(),
            SessionId = Guid.NewGuid(),
            MachineId = Guid.NewGuid(),
            HttpMethod = "POST",
            HttpPath = "/api/test",
            HttpStatusCode = 200,
            Hub = "AgentHub",
            HubMethod = "SendTelemetry",
            ConnectionId = "conn123",
            RequestId = "req456",
            TraceId = "trace789",
            SpanId = "span012",
            DataJson = "{\"key\":\"value\"}",
            Error = null
        };

        var dto = entity.ToDto();

        Assert.Equal(entity.Id, dto.Id);
        Assert.Equal(entity.TimestampUtc, dto.TimestampUtc);
        Assert.Equal(entity.Kind, dto.Kind);
        Assert.Equal(entity.EventName, dto.EventName);
        Assert.Equal(entity.Category, dto.Category);
        Assert.Equal(entity.Message, dto.Message);
        Assert.Equal(entity.Success, dto.Success);
        Assert.Equal(entity.Source, dto.Source);
        Assert.Equal(entity.ActorType, dto.ActorType);
        Assert.Equal(entity.ActorId, dto.ActorId);
        Assert.Equal(entity.ActorName, dto.ActorName);
        Assert.Equal(entity.ActorIp, dto.ActorIp);
        Assert.Equal(entity.UserAgent, dto.UserAgent);
        Assert.Equal(entity.NodeId, dto.NodeId);
        Assert.Equal(entity.CommandId, dto.CommandId);
        Assert.Equal(entity.SessionId, dto.SessionId);
        Assert.Equal(entity.MachineId, dto.MachineId);
        Assert.Equal(entity.HttpMethod, dto.HttpMethod);
        Assert.Equal(entity.HttpPath, dto.HttpPath);
        Assert.Equal(entity.HttpStatusCode, dto.HttpStatusCode);
        Assert.Equal(entity.Hub, dto.Hub);
        Assert.Equal(entity.HubMethod, dto.HubMethod);
        Assert.Equal(entity.ConnectionId, dto.ConnectionId);
        Assert.Equal(entity.RequestId, dto.RequestId);
        Assert.Equal(entity.TraceId, dto.TraceId);
        Assert.Equal(entity.SpanId, dto.SpanId);
        Assert.Equal(entity.DataJson, dto.DataJson);
        Assert.Equal(entity.Error, dto.Error);
    }

    [Fact]
    public void ToEntity_MapsAllProperties()
    {
        var dto = new AuditEventDto
        {
            Id = Guid.NewGuid(),
            TimestampUtc = DateTime.UtcNow,
            Kind = "audit",
            EventName = "test.event",
            Category = "test",
            Message = "Test message",
            Success = true,
            Source = "http",
            ActorType = "user",
            ActorId = "user123",
            ActorName = "Test User",
            ActorIp = "192.168.1.1",
            UserAgent = "Mozilla/5.0",
            NodeId = Guid.NewGuid(),
            CommandId = Guid.NewGuid(),
            SessionId = Guid.NewGuid(),
            MachineId = Guid.NewGuid(),
            HttpMethod = "POST",
            HttpPath = "/api/test",
            HttpStatusCode = 200,
            Hub = "AgentHub",
            HubMethod = "SendTelemetry",
            ConnectionId = "conn123",
            RequestId = "req456",
            TraceId = "trace789",
            SpanId = "span012",
            DataJson = "{\"key\":\"value\"}",
            Error = null
        };

        var entity = dto.ToEntity();

        Assert.Equal(dto.Id, entity.Id);
        Assert.Equal(dto.TimestampUtc, entity.TimestampUtc);
        Assert.Equal(dto.Kind, entity.Kind);
        Assert.Equal(dto.EventName, entity.EventName);
        Assert.Equal(dto.Category, entity.Category);
        Assert.Equal(dto.Message, entity.Message);
        Assert.Equal(dto.Success, entity.Success);
        Assert.Equal(dto.Source, entity.Source);
        Assert.Equal(dto.ActorType, entity.ActorType);
        Assert.Equal(dto.ActorId, entity.ActorId);
        Assert.Equal(dto.ActorName, entity.ActorName);
        Assert.Equal(dto.ActorIp, entity.ActorIp);
        Assert.Equal(dto.UserAgent, entity.UserAgent);
        Assert.Equal(dto.NodeId, entity.NodeId);
        Assert.Equal(dto.CommandId, entity.CommandId);
        Assert.Equal(dto.SessionId, entity.SessionId);
        Assert.Equal(dto.MachineId, entity.MachineId);
        Assert.Equal(dto.HttpMethod, entity.HttpMethod);
        Assert.Equal(dto.HttpPath, entity.HttpPath);
        Assert.Equal(dto.HttpStatusCode, entity.HttpStatusCode);
        Assert.Equal(dto.Hub, entity.Hub);
        Assert.Equal(dto.HubMethod, entity.HubMethod);
        Assert.Equal(dto.ConnectionId, entity.ConnectionId);
        Assert.Equal(dto.RequestId, entity.RequestId);
        Assert.Equal(dto.TraceId, entity.TraceId);
        Assert.Equal(dto.SpanId, entity.SpanId);
        Assert.Equal(dto.DataJson, entity.DataJson);
        Assert.Equal(dto.Error, entity.Error);
    }

    [Fact]
    public void ToEntities_MapsCollection()
    {
        var dtos = new List<AuditEventDto>
        {
            new() { Id = Guid.NewGuid(), EventName = "event1" },
            new() { Id = Guid.NewGuid(), EventName = "event2" },
            new() { Id = Guid.NewGuid(), EventName = "event3" }
        };

        var entities = dtos.ToEntities().ToList();

        Assert.Equal(3, entities.Count);
        Assert.Equal(dtos[0].Id, entities[0].Id);
        Assert.Equal(dtos[1].Id, entities[1].Id);
        Assert.Equal(dtos[2].Id, entities[2].Id);
    }
}
