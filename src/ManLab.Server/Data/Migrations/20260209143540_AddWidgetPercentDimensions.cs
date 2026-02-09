using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWidgetPercentDimensions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "HeightPercent",
                table: "WidgetConfigs",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WidthPercent",
                table: "WidgetConfigs",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HeightPercent",
                table: "WidgetConfigs");

            migrationBuilder.DropColumn(
                name: "WidthPercent",
                table: "WidgetConfigs");
        }
    }
}
