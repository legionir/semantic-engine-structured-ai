using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using CSharpApi.Services;

namespace CSharpApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WeatherController : ControllerBase
    {
        private readonly IWeatherService _weatherService;

        public WeatherController(IWeatherService weatherService)
        {
            _weatherService = weatherService;
        }

        [HttpGet]
        public IEnumerable<WeatherForecast> GetForecast()
        {
            return _weatherService.GetDailyForecast();
        }
    }
}
