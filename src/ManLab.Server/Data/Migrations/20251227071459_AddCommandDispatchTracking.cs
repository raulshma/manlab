using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCommandDispatchTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DispatchAttempts",
                table: "CommandQueue",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastDispatchAttemptAt",
                table: "CommandQueue",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SentAt",
                table: "CommandQueue",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DispatchAttempts",
                table: "CommandQueue");

            migrationBuilder.DropColumn(
                name: "LastDispatchAttemptAt",
                table: "CommandQueue");

            migrationBuilder.DropColumn(
                name: "SentAt",
                table: "CommandQueue");
        }
    }
}
