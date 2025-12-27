using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEnhancedTelemetryFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "NetRxBytesPerSec",
                table: "TelemetrySnapshots",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "NetTxBytesPerSec",
                table: "TelemetrySnapshots",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "PingPacketLossPercent",
                table: "TelemetrySnapshots",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "PingRttMs",
                table: "TelemetrySnapshots",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PingTarget",
                table: "TelemetrySnapshots",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CapabilitiesJson",
                table: "Nodes",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrimaryInterface",
                table: "Nodes",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NetRxBytesPerSec",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "NetTxBytesPerSec",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "PingPacketLossPercent",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "PingRttMs",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "PingTarget",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "CapabilitiesJson",
                table: "Nodes");

            migrationBuilder.DropColumn(
                name: "PrimaryInterface",
                table: "Nodes");
        }
    }
}
