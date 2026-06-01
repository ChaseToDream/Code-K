import { Routes, Route } from 'react-router-dom'
import { useState, useCallback } from 'react'
import type { FileStock, ParseProgress } from './lib/types'
import Layout from './components/Layout'
import Home from './pages/Home'
import Market from './pages/Market'
import StockDetail from './pages/StockDetail'

function App() {
  const [stocks, setStocks] = useState<FileStock[]>([])
  const [repoName, setRepoName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null)

  const handleRepoSelected = useCallback((path: string, name: string) => {
    setRepoPath(path)
    setRepoName(name)
    setStocks([])
  }, [])

  const handleRepoCleared = useCallback(() => {
    setRepoPath('')
    setRepoName('')
    setStocks([])
  }, [])

  return (
    <Layout stocks={stocks} repoName={repoName} onRepoCleared={handleRepoCleared}>
      <Routes>
        <Route
          path="/"
          element={
            <Home
              onRepoSelected={handleRepoSelected}
              onNavigate={() => {}}
            />
          }
        />
        <Route
          path="/market"
          element={
            <Market
              stocks={stocks}
              repoName={repoName}
              repoPath={repoPath}
              isParsing={isParsing}
              parseProgress={parseProgress}
              onParseStart={() => setIsParsing(true)}
              onParseEnd={() => setIsParsing(false)}
              onParseProgress={setParseProgress}
              onStocksUpdate={setStocks}
            />
          }
        />
        <Route
          path="/stock/:path"
          element={<StockDetail stocks={stocks} />}
        />
      </Routes>
    </Layout>
  )
}

export default App
