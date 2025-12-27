namespace ManLab.Agent.Telemetry;

internal sealed class RollingPingWindow
{
    private readonly bool[] _success;
    private readonly float[] _rttMs;
    private int _count;
    private int _index;

    public RollingPingWindow(int capacity)
    {
        if (capacity < 1) throw new ArgumentOutOfRangeException(nameof(capacity));
        _success = new bool[capacity];
        _rttMs = new float[capacity];
    }

    public void Add(bool success, float rttMs)
    {
        _success[_index] = success;
        _rttMs[_index] = rttMs;

        _index = (_index + 1) % _success.Length;
        if (_count < _success.Length)
        {
            _count++;
        }
    }

    public (float? avgRttMs, float? packetLossPercent, int samples) GetStats()
    {
        if (_count <= 0)
        {
            return (null, null, 0);
        }

        int failures = 0;
        int successCount = 0;
        double rttSum = 0;

        for (var i = 0; i < _count; i++)
        {
            if (_success[i])
            {
                successCount++;
                rttSum += _rttMs[i];
            }
            else
            {
                failures++;
            }
        }

        var loss = (float)failures / _count * 100f;
        float? avgRtt = successCount > 0 ? (float)(rttSum / successCount) : null;

        return (avgRtt, loss, _count);
    }
}
