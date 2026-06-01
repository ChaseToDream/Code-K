import { Routes, Route } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import Layout from './components/Layout'
import Home from './pages/Home'
import Market from './pages/Market'
import StockDetail from './pages/StockDetail'

function App() {
  return (
    <AppProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/market" element={<Market />} />
          <Route path="/stock/:path" element={<StockDetail />} />
        </Routes>
      </Layout>
    </AppProvider>
  )
}

export default App
