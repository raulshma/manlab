using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEnhancedTelemetryColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApmJson",
                table: "TelemetrySnapshots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EnhancedGpuJson",
                table: "TelemetrySnapshots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EnhancedNetworkJson",
                table: "TelemetrySnapshots",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApmJson",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "EnhancedGpuJson",
                table: "TelemetrySnapshots");

            migrationBuilder.DropColumn(
                name: "EnhancedNetworkJson",
                table: "TelemetrySnapshots");
        }
    }
}
