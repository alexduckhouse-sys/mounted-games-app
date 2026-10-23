using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class GlobalRulebooks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Rulebooks become shared by every competition: where several competitions held the same
            // title and edition, keep only the newest copy so the new unique index can be built.
            migrationBuilder.Sql(@"DELETE FROM ""Rulebook"" r WHERE EXISTS (
    SELECT 1 FROM ""Rulebook"" o
    WHERE o.""Title"" = r.""Title"" AND o.""Edition"" = r.""Edition""
      AND (o.""UpdatedAt"" > r.""UpdatedAt"" OR (o.""UpdatedAt"" = r.""UpdatedAt"" AND o.""Id"" > r.""Id"")));");

            migrationBuilder.DropForeignKey(
                name: "FK_Rulebook_Competitions_CompetitionId",
                table: "Rulebook");

            migrationBuilder.DropIndex(
                name: "IX_Rulebook_CompetitionId_Title_Edition",
                table: "Rulebook");

            migrationBuilder.DropColumn(
                name: "CompetitionId",
                table: "Rulebook");

            migrationBuilder.CreateIndex(
                name: "IX_Rulebook_Title_Edition",
                table: "Rulebook",
                columns: new[] { "Title", "Edition" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Rulebook_Title_Edition",
                table: "Rulebook");

            migrationBuilder.AddColumn<int>(
                name: "CompetitionId",
                table: "Rulebook",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_Rulebook_CompetitionId_Title_Edition",
                table: "Rulebook",
                columns: new[] { "CompetitionId", "Title", "Edition" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Rulebook_Competitions_CompetitionId",
                table: "Rulebook",
                column: "CompetitionId",
                principalTable: "Competitions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
