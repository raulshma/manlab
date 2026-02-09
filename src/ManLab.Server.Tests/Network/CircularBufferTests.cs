using ManLab.Server.Services.Network;

namespace ManLab.Server.Tests.Network;

public class CircularBufferTests
{
    [Fact]
    public void Add_SingleItem_ReturnsExpectedCount()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(5);

        // Act
        buffer.Add(1);

        // Assert
        Assert.Equal(1, buffer.Count);
        Assert.Equal(0, buffer.DroppedCount);
    }

    [Fact]
    public void Add_UpToCapacity_NoItemsDropped()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(3);

        // Act
        buffer.Add(1);
        buffer.Add(2);
        buffer.Add(3);

        // Assert
        Assert.Equal(3, buffer.Count);
        Assert.Equal(0, buffer.DroppedCount);
    }

    [Fact]
    public void Add_ExceedsCapacity_DropsOldestItems()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(3);

        // Act
        buffer.Add(1);
        buffer.Add(2);
        buffer.Add(3);
        var dropped = buffer.Add(4); // This should drop '1'

        // Assert
        Assert.True(dropped);
        Assert.Equal(3, buffer.Count);
        Assert.Equal(1, buffer.DroppedCount);

        var items = buffer.GetRecent(3);
        Assert.Equal([2, 3, 4], items);
    }

    [Fact]
    public void Add_MultipleOverflows_TracksDroppedCount()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(2);

        // Act
        buffer.Add(1);
        buffer.Add(2);
        buffer.Add(3); // Drops 1
        buffer.Add(4); // Drops 2
        buffer.Add(5); // Drops 3

        // Assert
        Assert.Equal(2, buffer.Count);
        Assert.Equal(3, buffer.DroppedCount);

        var items = buffer.GetRecent(2);
        Assert.Equal([4, 5], items);
    }

    [Fact]
    public void GetRecent_EmptyBuffer_ReturnsEmptyList()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(5);

        // Act
        var items = buffer.GetRecent(10);

        // Assert
        Assert.Empty(items);
    }

    [Fact]
    public void GetRecent_RequestedCountLessThanAvailable_ReturnsRequestedCount()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(5);
        buffer.Add(1);
        buffer.Add(2);
        buffer.Add(3);

        // Act
        var items = buffer.GetRecent(2);

        // Assert
        Assert.Equal(2, items.Count);
        Assert.Equal([2, 3], items); // Most recent items
    }

    [Fact]
    public void GetRecent_RequestedCountMoreThanAvailable_ReturnsAllAvailable()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(5);
        buffer.Add(1);
        buffer.Add(2);

        // Act
        var items = buffer.GetRecent(10);

        // Assert
        Assert.Equal(2, items.Count);
        Assert.Equal([1, 2], items);
    }

    [Fact]
    public void GetRecent_AfterWraparound_ReturnsCorrectOrder()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(3);

        // Act - fill and overflow multiple times
        for (var i = 1; i <= 10; i++)
        {
            buffer.Add(i);
        }

        // Assert
        var items = buffer.GetRecent(3);
        Assert.Equal([8, 9, 10], items);
    }

    [Fact]
    public void Clear_ResetsCountAndPreservesDroppedCount()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(2);
        buffer.Add(1);
        buffer.Add(2);
        buffer.Add(3); // Drops 1
        var droppedBefore = buffer.DroppedCount;

        // Act
        buffer.Clear();

        // Assert
        Assert.Equal(0, buffer.Count);
        Assert.Equal(droppedBefore, buffer.DroppedCount); // Dropped count preserved
    }

    [Fact]
    public void Reset_ClearsEverything()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(2);
        buffer.Add(1);
        buffer.Add(2);
        buffer.Add(3); // Drops 1

        // Act
        buffer.Reset();

        // Assert
        Assert.Equal(0, buffer.Count);
        Assert.Equal(0, buffer.DroppedCount);
    }

    [Fact]
    public void ResetDroppedCount_OnlyResetsDroppedCount()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(2);
        buffer.Add(1);
        buffer.Add(2);
        buffer.Add(3); // Drops 1

        // Act
        buffer.ResetDroppedCount();

        // Assert
        Assert.Equal(2, buffer.Count); // Items preserved
        Assert.Equal(0, buffer.DroppedCount); // Dropped count reset
    }

    [Fact]
    public void Constructor_InvalidCapacity_ThrowsArgumentOutOfRangeException()
    {
        // Arrange & Act & Assert
        Assert.Throws<ArgumentOutOfRangeException>(() => new CircularBuffer<int>(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new CircularBuffer<int>(-1));
    }

    [Fact]
    public void Capacity_ReturnsCorrectValue()
    {
        // Arrange
        var buffer = new CircularBuffer<int>(100);

        // Assert
        Assert.Equal(100, buffer.Capacity);
    }

    [Fact]
    public void GetRecent_WithReferenceTypes_WorksCorrectly()
    {
        // Arrange
        var buffer = new CircularBuffer<string>(3);
        buffer.Add("one");
        buffer.Add("two");
        buffer.Add("three");
        buffer.Add("four");

        // Act
        var items = buffer.GetRecent(2);

        // Assert
        Assert.Equal(["three", "four"], items);
    }

    [Fact]
    public void Add_HighVolume_MaintainsIntegrity()
    {
        // Arrange
        const int capacity = 100;
        const int iterations = 10000;
        var buffer = new CircularBuffer<int>(capacity);

        // Act
        for (var i = 0; i < iterations; i++)
        {
            buffer.Add(i);
        }

        // Assert
        Assert.Equal(capacity, buffer.Count);
        Assert.Equal(iterations - capacity, buffer.DroppedCount);

        var items = buffer.GetRecent(capacity);
        Assert.Equal(capacity, items.Count);

        // Verify items are in correct order (most recent)
        for (var i = 0; i < capacity; i++)
        {
            Assert.Equal(iterations - capacity + i, items[i]);
        }
    }
}
