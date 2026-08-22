#include "../include/engine.hpp"
#include <numeric>

namespace Core {

ComputeEngine::ComputeEngine(const Config& config)
    : m_config(config), m_initialized(true) {}

ComputeEngine::~ComputeEngine() {}

int ComputeEngine::execute(const std::vector<int>& data) {
    return std::accumulate(data.begin(), data.end(), 0);
}

std::string ComputeEngine::getStatus() const {
    return m_initialized ? "READY" : "UNINITIALIZED";
}

} // namespace Core
