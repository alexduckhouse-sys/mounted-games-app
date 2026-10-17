using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Commerce;

public static class CommerceSqliteSchema
{
    public static Task EnsureAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "CatalogueItem" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "SellerUserId" TEXT NOT NULL,
            "Title" TEXT NOT NULL,
            "Description" TEXT NOT NULL,
            "PriceMinor" INTEGER NOT NULL,
            "Currency" TEXT NOT NULL DEFAULT 'GBP',
            "StockQuantity" INTEGER,
            "Category" INTEGER NOT NULL,
            "ImageUrl" TEXT,
            "IsActive" INTEGER NOT NULL,
            "Version" INTEGER NOT NULL DEFAULT 1,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_CatalogueItem_AspNetUsers_SellerUserId" FOREIGN KEY ("SellerUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS "IX_CatalogueItem_SellerUserId_IsActive" ON "CatalogueItem" ("SellerUserId", "IsActive");

        CREATE TABLE IF NOT EXISTS "EventCommerceSettings" (
            "CompetitionId" INTEGER NOT NULL,
            "IsDemo" INTEGER NOT NULL,
            "UpdatedByUserId" TEXT,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "PK_EventCommerceSettings" PRIMARY KEY ("CompetitionId"),
            CONSTRAINT "FK_EventCommerceSettings_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS "EventOrder" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "BuyerUserId" TEXT NOT NULL,
            "IdempotencyKey" TEXT NOT NULL,
            "RequestHash" TEXT NOT NULL,
            "Status" INTEGER NOT NULL,
            "TotalMinor" INTEGER NOT NULL,
            "Currency" TEXT NOT NULL DEFAULT 'GBP',
            "IsTestOrder" INTEGER NOT NULL,
            "HasStockReservation" INTEGER NOT NULL,
            "PaidAt" TEXT,
            "CancelledAt" TEXT,
            "RefundedAt" TEXT,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_EventOrder_AspNetUsers_BuyerUserId" FOREIGN KEY ("BuyerUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT,
            CONSTRAINT "FK_EventOrder_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE RESTRICT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_EventOrder_BuyerUserId_IdempotencyKey" ON "EventOrder" ("BuyerUserId", "IdempotencyKey");

        CREATE INDEX IF NOT EXISTS "IX_EventOrder_CompetitionId_CreatedAt" ON "EventOrder" ("CompetitionId", "CreatedAt");

        CREATE TABLE IF NOT EXISTS "CompetitionListing" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "CatalogueItemId" INTEGER NOT NULL,
            "SellerUserId" TEXT NOT NULL,
            "Status" INTEGER NOT NULL,
            "ReviewNote" TEXT,
            "ReviewedByUserId" TEXT,
            "ReviewedAt" TEXT,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_CompetitionListing_CatalogueItem_CatalogueItemId" FOREIGN KEY ("CatalogueItemId") REFERENCES "CatalogueItem" ("Id") ON DELETE RESTRICT,
            CONSTRAINT "FK_CompetitionListing_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "IX_CompetitionListing_CatalogueItemId" ON "CompetitionListing" ("CatalogueItemId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_CompetitionListing_CompetitionId_CatalogueItemId" ON "CompetitionListing" ("CompetitionId", "CatalogueItemId");

        CREATE INDEX IF NOT EXISTS "IX_CompetitionListing_SellerUserId_Status" ON "CompetitionListing" ("SellerUserId", "Status");

        CREATE TABLE IF NOT EXISTS "EventOrderLine" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "EventOrderId" INTEGER NOT NULL,
            "CompetitionListingId" INTEGER NOT NULL,
            "CatalogueItemId" INTEGER NOT NULL,
            "SellerUserId" TEXT NOT NULL,
            "TitleSnapshot" TEXT NOT NULL,
            "UnitPriceMinorSnapshot" INTEGER NOT NULL,
            "Quantity" INTEGER NOT NULL,
            "ReservedStockQuantity" INTEGER NOT NULL DEFAULT 0,
            "LineTotalMinor" INTEGER NOT NULL,
            CONSTRAINT "FK_EventOrderLine_EventOrder_EventOrderId" FOREIGN KEY ("EventOrderId") REFERENCES "EventOrder" ("Id") ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "IX_EventOrderLine_EventOrderId" ON "EventOrderLine" ("EventOrderId");

        CREATE INDEX IF NOT EXISTS "IX_EventOrderLine_SellerUserId_EventOrderId" ON "EventOrderLine" ("SellerUserId", "EventOrderId");

        CREATE TABLE IF NOT EXISTS "TestPaymentRecord" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "Target" INTEGER NOT NULL,
            "TargetId" INTEGER NOT NULL,
            "EventOrderId" INTEGER,
            "OwnerUserId" TEXT NOT NULL,
            "IdempotencyKey" TEXT NOT NULL,
            "Operation" INTEGER NOT NULL,
            "RequestedOutcome" INTEGER,
            "Status" INTEGER NOT NULL,
            "AmountMinor" INTEGER NOT NULL,
            "Currency" TEXT NOT NULL DEFAULT 'GBP',
            "IsTest" INTEGER NOT NULL,
            "Provider" TEXT NOT NULL DEFAULT 'fake',
            "ReceiptReference" TEXT NOT NULL,
            "ReceiptLabel" TEXT NOT NULL,
            "RelatedPaymentId" INTEGER,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_TestPaymentRecord_EventOrder_EventOrderId" FOREIGN KEY ("EventOrderId") REFERENCES "EventOrder" ("Id") ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "IX_TestPaymentRecord_CompetitionId_Target_TargetId" ON "TestPaymentRecord" ("CompetitionId", "Target", "TargetId");

        CREATE INDEX IF NOT EXISTS "IX_TestPaymentRecord_EventOrderId" ON "TestPaymentRecord" ("EventOrderId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_TestPaymentRecord_OwnerUserId_IdempotencyKey" ON "TestPaymentRecord" ("OwnerUserId", "IdempotencyKey");
        """);
}
