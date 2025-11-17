'use client'

import { ThemeProvider } from './theme-provider'
import { Toaster } from './ui/sonner'
import React from 'react'
import { ClusterChecker } from '@/components/cluster/cluster-ui'
import { AccountChecker } from '@/components/account/account-ui'

export function AppLayout({
  children,
  // links,
}: {
  children: React.ReactNode
  // links: { label: string; path: string }[]
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <div className="flex flex-col min-h-screen">
        {/* <AppHeader links={links} /> */}
        <main className="">
          <ClusterChecker>
            <AccountChecker />
          </ClusterChecker>
          {children}
        </main>
        {/* <AppFooter /> */}
      </div>
      <Toaster />
    </ThemeProvider>
  )
}
