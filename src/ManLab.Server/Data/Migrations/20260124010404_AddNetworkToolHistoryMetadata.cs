using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNetworkToolHistoryMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "NetworkToolHistory",
                type: "character varying(4096)",
                maxLength: 4096,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TagsJson",
                table: "NetworkToolHistory",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedUtc",
                table: "NetworkToolHistory",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Notes",
                table: "NetworkToolHistory");

            migrationBuilder.DropColumn(
                name: "TagsJson",
                table: "NetworkToolHistory");

            migrationBuilder.DropColumn(
                name: "UpdatedUtc",
                table: "NetworkToolHistory");
        }
    }
}
