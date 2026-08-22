#pragma once
#include <string>
#include <vector>

namespace Core {

struct Config {
    int maxThreads;
    std::string profile;
};

class ComputeEngine {
public:
    ComputeEngine(const Config& config);
    virtual ~ComputeEngine();

    int execute(const std::vector<int>& data);
    std::string getStatus() const;

private:
    Config m_config;
    bool m_initialized;
};

} // namespace Core
