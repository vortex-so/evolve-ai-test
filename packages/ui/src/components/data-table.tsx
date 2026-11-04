"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"

import { Button } from "@vortex/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vortex/ui/components/table"
import { cn } from "@vortex/ui/lib/utils"

export type DataTableColumn<TData> = {
  id: string
  header: React.ReactNode
  cell?: (context: { row: { original: TData } }) => React.ReactNode
  className?: string
}

type CursorControls = {
  next?: string
  onNext?: () => void
  onPrev?: () => void
  hasPrev?: boolean
}

type DataTableProps<TData> = {
  columns: ColumnDef<any, any>[] | DataTableColumn<TData>[]
  data: TData[]
  loading?: boolean
  emptyMessage?: string
  cursor?: CursorControls
  filterInput?: React.ReactNode
  error?: string
  getRowId?: (row: TData, index: number) => string
  onRowClick?: (row: TData) => void
  renderExpandedRow?: (row: TData) => React.ReactNode
  className?: string
}

function DataTable<TData>({
  columns,
  data,
  loading = false,
  emptyMessage = "No results.",
  cursor,
  filterInput,
  error,
  getRowId,
  onRowClick,
  renderExpandedRow,
  className,
}: DataTableProps<TData>) {
  const useLegacyMode = Boolean(error || getRowId || onRowClick || renderExpandedRow)

  if (useLegacyMode) {
    const legacyColumns = columns as DataTableColumn<TData>[]
    const rowCount = legacyColumns.length || 1

    return (
      <div className={cn("space-y-4", className)}>
        {filterInput ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {filterInput}
          </div>
        ) : null}
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {legacyColumns.map((column) => (
                  <TableHead key={column.id} className={column.className}>
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, rowIndex) => (
                  <TableRow key={`legacy-skeleton-${rowIndex}`} className="hover:bg-transparent">
                    {Array.from({ length: rowCount }).map((__, columnIndex) => (
                      <TableCell key={`legacy-skeleton-${rowIndex}-${columnIndex}`}>
                        <div
                          className={cn(
                            "h-4 animate-pulse rounded bg-muted",
                            columnIndex === 0 ? "w-24" : "w-full max-w-40"
                          )}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={rowCount} className="py-10 text-center text-sm text-destructive">
                    {error}
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={rowCount} className="py-10 text-center text-sm text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row, index) => {
                  const expandedRow = renderExpandedRow?.(row)
                  const rowKey = getRowId?.(row, index) ?? String(index)

                  return (
                    <React.Fragment key={rowKey}>
                      <TableRow
                        className={cn(onRowClick ? "cursor-pointer hover:bg-muted/30" : "hover:bg-muted/30")}
                        onClick={() => onRowClick?.(row)}
                      >
                        {legacyColumns.map((column) => (
                          <TableCell key={column.id} className={column.className}>
                            {column.cell ? column.cell({ row: { original: row } }) : null}
                          </TableCell>
                        ))}
                      </TableRow>
                      {expandedRow ? (
                        <TableRow>
                          <TableCell colSpan={rowCount} className="p-0">
                            {expandedRow}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  const table = useReactTable({
    data,
    columns: columns as ColumnDef<TData>[],
    getCoreRowModel: getCoreRowModel(),
  })

  const visibleColumnCount = table.getVisibleLeafColumns().length || columns.length || 1

  return (
    <div className={cn("space-y-4", className)}>
      {filterInput ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {filterInput}
        </div>
      ) : null}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 8 }).map((_, rowIndex) => (
                  <TableRow key={`skeleton-${rowIndex}`} className="hover:bg-transparent">
                    {Array.from({ length: visibleColumnCount }).map((__, columnIndex) => (
                      <TableCell key={`skeleton-${rowIndex}-${columnIndex}`}>
                        <div
                          className={cn(
                            "h-4 animate-pulse rounded bg-muted",
                            columnIndex === 0 ? "w-24" : "w-full max-w-40"
                          )}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : null}

            {!loading && table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumnCount} className="py-10 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : null}

            {!loading
              ? table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : null}
          </TableBody>
        </Table>
      </div>

      {cursor ? (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={cursor.onPrev} disabled={!cursor.hasPrev || loading}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={cursor.onNext} disabled={!cursor.next || loading}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export { DataTable, type DataTableProps }
