using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAgentResourceUsageToTelemetry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<float>(
                name: "AgentCpuPercent",
                table: "TelemetrySnapshots",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "AgentGcHeapBytes",
                table: "TelemetrySnapshots",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "AgentMemoryBytes",
                table: "TelemetrySnapshots",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AgentThreadCount",
                table: "TelemetrySnapshots",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AgentCpuPercent",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "AgentGcHeapBytes",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "AgentMemoryBytes",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "AgentThreadCount",
                table: "TelemetrySnapshots");
        }
    }
}
