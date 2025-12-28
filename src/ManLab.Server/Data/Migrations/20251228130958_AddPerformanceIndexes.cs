using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_SmartDriveSnapshots_NodeId_Timestamp_Device",
                table: "SmartDriveSnapshots",
                columns: new[] { "NodeId", "Timestamp", "Device" });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceStatusSnapshots_NodeId_Timestamp_ServiceName",
                table: "ServiceStatusSnapshots",
                columns: new[] { "NodeId", "Timestamp", "ServiceName" });

            migrationBuilder.CreateIndex(
                name: "IX_Nodes_AuthKeyHash",
                table: "Nodes",
                column: "AuthKeyHash");

            migrationBuilder.CreateIndex(
                name: "IX_LogViewerPolicies_NodeId_DisplayName",
                table: "LogViewerPolicies",
                columns: new[] { "NodeId", "DisplayName" });

            migrationBuilder.CreateIndex(
                name: "IX_GpuSnapshots_NodeId_Timestamp_GpuIndex",
                table: "GpuSnapshots",
                columns: new[] { "NodeId", "Timestamp", "GpuIndex" });

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_NodeId_CommandType_Status_CreatedAt",
                table: "CommandQueue",
                columns: new[] { "NodeId", "CommandType", "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_NodeId_CreatedAt",
                table: "CommandQueue",
                columns: new[] { "NodeId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SmartDriveSnapshots_NodeId_Timestamp_Device",
                table: "SmartDriveSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_ServiceStatusSnapshots_NodeId_Timestamp_ServiceName",
                table: "ServiceStatusSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_Nodes_AuthKeyHash",
                table: "Nodes");

            migrationBuilder.DropIndex(
                name: "IX_LogViewerPolicies_NodeId_DisplayName",
                table: "LogViewerPolicies");

            migrationBuilder.DropIndex(
                name: "IX_GpuSnapshots_NodeId_Timestamp_GpuIndex",
                table: "GpuSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_CommandQueue_NodeId_CommandType_Status_CreatedAt",
                table: "CommandQueue");

            migrationBuilder.DropIndex(
                name: "IX_CommandQueue_NodeId_CreatedAt",
                table: "CommandQueue");
        }
    }
}
